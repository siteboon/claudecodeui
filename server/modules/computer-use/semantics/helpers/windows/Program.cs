using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Automation;

static class Program
{
    private static readonly Dictionary<string, List<ElementRecord>> StateElements = new();
    private static readonly Dictionary<string, Dictionary<string, AutomationElement>> StateAutomationElements = new();

    public static void Main()
    {
        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var id = root.TryGetProperty("id", out var idValue) ? idValue.Clone() : default;
                var method = root.TryGetProperty("method", out var methodValue) ? methodValue.GetString() ?? "" : "";
                var parameters = root.TryGetProperty("params", out var paramsValue) && paramsValue.ValueKind == JsonValueKind.Object
                    ? paramsValue.Clone()
                    : JsonDocument.Parse("{}").RootElement.Clone();

                try
                {
                    object result = method switch
                    {
                        "list_apps" => ListApps(),
                        "get_app_state" => GetAppState(parameters),
                        "click_element" => ClickElement(parameters),
                        "perform_secondary_action" => PerformSecondaryAction(parameters),
                        "set_value" => SetValue(parameters),
                        "type_text" => TypeText(parameters),
                        "press_key" => PressKey(parameters),
                        "scroll_element" => ScrollElement(parameters),
                        "drag" => Drag(parameters),
                        _ => throw new InvalidOperationException($"Method is not implemented yet: {method}")
                    };
                    Write(new Dictionary<string, object?> { ["id"] = JsonValue(id), ["result"] = result });
                }
                catch (Exception ex)
                {
                    Write(new Dictionary<string, object?> { ["id"] = JsonValue(id), ["error"] = ex.Message });
                }
            }
            catch (Exception ex)
            {
                Write(new Dictionary<string, object?> { ["id"] = null, ["error"] = $"Invalid JSON request: {ex.Message}" });
            }
        }
    }

    private static object? JsonValue(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.TryGetInt64(out var number) ? number : element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };
    }

    private static void Write(object value)
    {
        Console.WriteLine(JsonSerializer.Serialize(value));
        Console.Out.Flush();
    }

    private static List<Dictionary<string, object?>> ListApps()
    {
        return Process.GetProcesses()
            .Where(process => process.MainWindowHandle != IntPtr.Zero)
            .OrderBy(process => process.ProcessName)
            .Select(process => new Dictionary<string, object?>
            {
                ["id"] = process.Id.ToString(),
                ["name"] = process.ProcessName,
                ["processName"] = process.ProcessName,
                ["pid"] = process.Id,
                ["running"] = true,
                ["windowTitle"] = process.MainWindowTitle
            })
            .ToList();
    }

    private static Process ResolveProcess(string query)
    {
        var normalized = query.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new InvalidOperationException("app is required.");
        }

        var processes = Process.GetProcesses()
            .Where(process => process.MainWindowHandle != IntPtr.Zero)
            .ToList();

        return processes.FirstOrDefault(process => process.ProcessName.Equals(normalized, StringComparison.OrdinalIgnoreCase))
            ?? processes.FirstOrDefault(process => process.MainWindowTitle.Equals(normalized, StringComparison.OrdinalIgnoreCase))
            ?? processes.FirstOrDefault(process => process.MainWindowTitle.Contains(normalized, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"App is not running: {query}");
    }

    private static Dictionary<string, object?> GetAppState(JsonElement parameters)
    {
        var appQuery = ReadString(parameters, "app");
        var process = ResolveProcess(appQuery);
        var root = AutomationElement.FromHandle(process.MainWindowHandle)
            ?? throw new InvalidOperationException("No UI Automation root window is available.");

        var records = new List<ElementRecord>();
        var automationElements = new Dictionary<string, AutomationElement>();
        Walk(root, records, automationElements, 0, 5, 300);
        var stateId = $"state_{Guid.NewGuid()}";
        StateElements[stateId] = records;
        StateAutomationElements[stateId] = automationElements;

        var elements = records.Select(record => record.ToDictionary()).ToList();
        var bounds = root.Current.BoundingRectangle;
        return new Dictionary<string, object?>
        {
            ["stateId"] = stateId,
            ["app"] = process.ProcessName,
            ["platform"] = "win32",
            ["screenshotDataUrl"] = CaptureScreen(),
            ["displaySize"] = new Dictionary<string, object?>
            {
                ["width"] = (int)System.Windows.Forms.Screen.PrimaryScreen!.Bounds.Width,
                ["height"] = (int)System.Windows.Forms.Screen.PrimaryScreen!.Bounds.Height
            },
            ["window"] = new Dictionary<string, object?>
            {
                ["title"] = process.MainWindowTitle,
                ["bounds"] = BoundsDictionary(bounds)
            },
            ["elements"] = elements,
            ["accessibilityTree"] = elements,
            ["treeText"] = string.Join("\n", elements.Select(element => $"{element["index"]} {element["role"]} {element.GetValueOrDefault("title")}"))
        };
    }

    private static Dictionary<string, object?> ClickElement(JsonElement parameters)
    {
        var mouseButton = ReadString(parameters, "mouse_button");
        if ((mouseButton == "" || mouseButton == "left") && ReadInt(parameters, "click_count", 1) == 1)
        {
            var element = AutomationElementFor(parameters);
            if (element != null && TryInvoke(element))
            {
                return GetAppState(parameters);
            }
        }

        var point = PointFor(parameters);
        if (point == null)
        {
            throw new InvalidOperationException("click_element requires x/y or stateId + element_index.");
        }

        SendMouseClick(point.Value.X, point.Value.Y, ReadString(parameters, "mouse_button"), ReadInt(parameters, "click_count", 1));
        return GetAppState(parameters);
    }

    private static Dictionary<string, object?> PerformSecondaryAction(JsonElement parameters)
    {
        var point = PointFor(parameters);
        if (point == null)
        {
            throw new InvalidOperationException("perform_secondary_action requires x/y or stateId + element_index.");
        }

        SendMouseClick(point.Value.X, point.Value.Y, "right", 1);
        return GetAppState(parameters);
    }

    private static Dictionary<string, object?> SetValue(JsonElement parameters)
    {
        var value = ReadString(parameters, "value");
        var element = AutomationElementFor(parameters);
        var focused = false;
        if (element != null)
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var valuePattern))
            {
                ((ValuePattern)valuePattern).SetValue(value);
                return GetAppState(parameters);
            }

            try
            {
                element.SetFocus();
                focused = true;
            }
            catch
            {
                // Fall through to coordinate focus below.
            }
        }

        var point = PointFor(parameters);
        if (point != null)
        {
            SendMouseClick(point.Value.X, point.Value.Y, "left", 1);
            focused = true;
        }
        else if (!focused && element == null)
        {
            throw new InvalidOperationException("set_value requires x/y or stateId + element_index.");
        }
        else if (!focused)
        {
            throw new InvalidOperationException("set_value could not focus the requested element.");
        }
        System.Windows.Forms.SendKeys.SendWait("^a");
        System.Windows.Forms.SendKeys.SendWait(EscapeSendKeys(value));
        return GetAppState(parameters);
    }

    private static Dictionary<string, object?> TypeText(JsonElement parameters)
    {
        var text = ReadString(parameters, "text");
        System.Windows.Forms.SendKeys.SendWait(EscapeSendKeys(text));
        return GetAppState(parameters);
    }

    private static Dictionary<string, object?> PressKey(JsonElement parameters)
    {
        var key = ReadString(parameters, "key");
        System.Windows.Forms.SendKeys.SendWait(ToSendKeysChord(key));
        return GetAppState(parameters);
    }

    private static Dictionary<string, object?> ScrollElement(JsonElement parameters)
    {
        var element = AutomationElementFor(parameters);
        var direction = ReadString(parameters, "direction");
        var pages = ReadDouble(parameters, "pages", 1);
        if (element != null && element.TryGetCurrentPattern(ScrollPattern.Pattern, out var scrollPatternValue))
        {
            var scrollPattern = (ScrollPattern)scrollPatternValue;
            var vertical = direction == "up" ? ScrollAmount.LargeDecrement : direction == "down" ? ScrollAmount.LargeIncrement : ScrollAmount.NoAmount;
            var horizontal = direction == "left" ? ScrollAmount.LargeDecrement : direction == "right" ? ScrollAmount.LargeIncrement : ScrollAmount.NoAmount;
            scrollPattern.Scroll(horizontal, vertical);
            return GetAppState(parameters);
        }

        var point = PointFor(parameters);
        if (point == null)
        {
            throw new InvalidOperationException("scroll_element requires x/y or stateId + element_index.");
        }
        SetCursorPos(point.Value.X, point.Value.Y);
        var wheel = (int)Math.Round(Math.Max(1, pages) * 120);
        if (direction == "up") wheel = -wheel;
        mouse_event(0x0800, 0, 0, unchecked((uint)wheel), UIntPtr.Zero);
        return GetAppState(parameters);
    }

    private static Dictionary<string, object?> Drag(JsonElement parameters)
    {
        var fromX = ReadDouble(parameters, "from_x", double.NaN);
        var fromY = ReadDouble(parameters, "from_y", double.NaN);
        var toX = ReadDouble(parameters, "to_x", double.NaN);
        var toY = ReadDouble(parameters, "to_y", double.NaN);
        if (double.IsNaN(fromX) || double.IsNaN(fromY) || double.IsNaN(toX) || double.IsNaN(toY))
        {
            throw new InvalidOperationException("drag requires from_x/from_y/to_x/to_y.");
        }

        SetCursorPos((int)Math.Round(fromX), (int)Math.Round(fromY));
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(80);
        SetCursorPos((int)Math.Round(toX), (int)Math.Round(toY));
        Thread.Sleep(80);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
        return GetAppState(parameters);
    }

    private static void Walk(AutomationElement element, List<ElementRecord> records, Dictionary<string, AutomationElement> automationElements, int depth, int maxDepth, int limit)
    {
        if (depth > maxDepth || records.Count >= limit) return;
        var index = (records.Count + 1).ToString();
        records.Add(ElementRecord.From(element, index));
        automationElements[index] = element;
        var children = element.FindAll(TreeScope.Children, Condition.TrueCondition);
        foreach (AutomationElement child in children)
        {
            Walk(child, records, automationElements, depth + 1, maxDepth, limit);
            if (records.Count >= limit) return;
        }
    }

    private static string ReadString(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";
    }

    private static int ReadInt(JsonElement element, string property, int defaultValue)
    {
        return element.TryGetProperty(property, out var value) && value.TryGetInt32(out var number)
            ? number
            : defaultValue;
    }

    private static double ReadDouble(JsonElement element, string property, double defaultValue)
    {
        return element.TryGetProperty(property, out var value) && value.TryGetDouble(out var number)
            ? number
            : defaultValue;
    }

    private static AutomationElement? AutomationElementFor(JsonElement parameters)
    {
        var stateId = ReadString(parameters, "stateId");
        var elementIndex = ReadString(parameters, "element_index");
        return !string.IsNullOrWhiteSpace(stateId)
            && !string.IsNullOrWhiteSpace(elementIndex)
            && StateAutomationElements.TryGetValue(stateId, out var elements)
            && elements.TryGetValue(elementIndex, out var element)
            ? element
            : null;
    }

    private static System.Drawing.Point? PointFor(JsonElement parameters)
    {
        if (parameters.TryGetProperty("x", out var xValue) && parameters.TryGetProperty("y", out var yValue)
            && xValue.TryGetDouble(out var x) && yValue.TryGetDouble(out var y))
        {
            return new System.Drawing.Point((int)Math.Round(x), (int)Math.Round(y));
        }

        var stateId = ReadString(parameters, "stateId");
        var elementIndex = ReadString(parameters, "element_index");
        if (string.IsNullOrWhiteSpace(stateId) || string.IsNullOrWhiteSpace(elementIndex)) return null;
        if (!StateElements.TryGetValue(stateId, out var elements)) return null;
        var element = elements.FirstOrDefault(item => item.Index == elementIndex);
        if (element?.Bounds == null) return null;
        return new System.Drawing.Point(
            (int)Math.Round(element.Bounds.Value.Left + element.Bounds.Value.Width / 2),
            (int)Math.Round(element.Bounds.Value.Top + element.Bounds.Value.Height / 2)
        );
    }

    private static string CaptureScreen()
    {
        var bounds = System.Windows.Forms.Screen.PrimaryScreen!.Bounds;
        using var bitmap = new Bitmap(bounds.Width, bounds.Height);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        return $"data:image/png;base64,{Convert.ToBase64String(stream.ToArray())}";
    }

    private static Dictionary<string, object?> BoundsDictionary(System.Windows.Rect rect)
    {
        return new Dictionary<string, object?>
        {
            ["x"] = rect.X,
            ["y"] = rect.Y,
            ["width"] = rect.Width,
            ["height"] = rect.Height
        };
    }

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    private static void SendMouseClick(int x, int y, string button, int clickCount)
    {
        var (down, up) = button switch
        {
            "right" => (0x0008u, 0x0010u),
            "middle" => (0x0020u, 0x0040u),
            _ => (0x0002u, 0x0004u)
        };
        SetCursorPos(x, y);
        for (var i = 0; i < Math.Max(1, clickCount); i++)
        {
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(80);
        }
    }

    private static bool TryInvoke(AutomationElement element)
    {
        try
        {
            if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern)) return false;
            ((InvokePattern)pattern).Invoke();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string EscapeSendKeys(string value)
    {
        return value
            .Replace("{", "{{}")
            .Replace("}", "{}}")
            .Replace("+", "{+}")
            .Replace("^", "{^}")
            .Replace("%", "{%}")
            .Replace("~", "{~}")
            .Replace("(", "{(}")
            .Replace(")", "{)}")
            .Replace("[", "{[}")
            .Replace("]", "{]}");
    }

    private static string ToSendKeysChord(string key)
    {
        var normalized = key.Trim();
        if (normalized.Contains('+'))
        {
            var parts = normalized.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var modifiers = "";
            var last = parts.LastOrDefault() ?? "";
            foreach (var part in parts.Take(parts.Length - 1))
            {
                modifiers += part.ToLowerInvariant() switch
                {
                    "ctrl" or "control" => "^",
                    "alt" => "%",
                    "shift" => "+",
                    "cmd" or "win" or "windows" => "^",
                    _ => ""
                };
            }
            return modifiers + SendKeyName(last);
        }
        return SendKeyName(normalized);
    }

    private static string SendKeyName(string key)
    {
        return key.ToLowerInvariant() switch
        {
            "return" or "enter" => "{ENTER}",
            "escape" or "esc" => "{ESC}",
            "tab" => "{TAB}",
            "backspace" => "{BACKSPACE}",
            "delete" or "del" => "{DELETE}",
            "left" => "{LEFT}",
            "right" => "{RIGHT}",
            "up" => "{UP}",
            "down" => "{DOWN}",
            "space" => " ",
            _ => key.Length == 1 ? EscapeSendKeys(key) : $"{{{key.ToUpperInvariant()}}}"
        };
    }

    private sealed record ElementRecord(
        string Index,
        string Role,
        string? Title,
        string? Value,
        System.Windows.Rect? Bounds,
        List<string> Actions)
    {
        public static ElementRecord From(AutomationElement element, string index)
        {
            var patterns = element.GetSupportedPatterns().Select(pattern => pattern.ProgrammaticName).ToList();
            return new ElementRecord(
                index,
                element.Current.ControlType.ProgrammaticName.Replace("ControlType.", ""),
                element.Current.Name,
                TryValue(element),
                element.Current.BoundingRectangle,
                patterns
            );
        }

        public Dictionary<string, object?> ToDictionary()
        {
            var output = new Dictionary<string, object?>
            {
                ["index"] = Index,
                ["role"] = Role,
                ["actions"] = Actions
            };
            if (!string.IsNullOrEmpty(Title)) output["title"] = Title;
            if (!string.IsNullOrEmpty(Value)) output["value"] = Value;
            if (Bounds != null) output["bounds"] = BoundsDictionary(Bounds.Value);
            return output;
        }

        private static string? TryValue(AutomationElement element)
        {
            try
            {
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern))
                {
                    return ((ValuePattern)pattern).Current.Value;
                }
            }
            catch
            {
                return null;
            }
            return null;
        }
    }
}
