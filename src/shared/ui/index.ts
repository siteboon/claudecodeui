/**
 * The shared UI primitives.
 *
 * The rule is that a component earns a place here once a second feature module
 * renders it. Card, Collapsible and Shimmer currently have consumers in the chat
 * module only, and they stay anyway: 16 files across six modules hand-roll their
 * own expand/collapse state today, and moving Collapsible into chat/ would put
 * it behind a module boundary that makes it unreachable to the five modules with
 * the clearest use for it. The two-module rule is a bar for admission, not a
 * trigger for eviction.
 *
 * PromptInput, Reasoning, Queue and Confirmation did move out, on a different
 * test: they are not primitives at all but chat-domain compositions — the
 * composer form, the assistant-reasoning disclosure, the tool todo list and the
 * inline tool-permission request — with chat vocabulary in their prop names and
 * no plausible second consumer. Alert went with Confirmation, which was its only
 * importer and the reason it existed.
 */

export { ActionMenu } from '@/shared/ui/ActionMenu';
export { Badge } from '@/shared/ui/Badge';
export { Button, buttonVariants } from '@/shared/ui/Button';
export { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/shared/ui/Card';
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui/Collapsible';
export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/shared/ui/Command';
export { DarkModeToggle } from '@/shared/ui/DarkModeToggle';
export { Dialog, DialogTrigger, DialogContent, DialogTitle } from '@/shared/ui/Dialog';
export { Input } from '@/shared/ui/Input';
export { LLMProviderLogo } from '@/shared/ui/LLMProviderLogo';
export { PillBar, Pill } from '@/shared/ui/PillBar';
export { ScrollArea } from '@/shared/ui/ScrollArea';
export { Shimmer } from '@/shared/ui/Shimmer';
export { Tooltip } from '@/shared/ui/Tooltip';
