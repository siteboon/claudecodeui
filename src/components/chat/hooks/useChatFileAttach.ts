import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../../utils/api";
import type { Project } from "../../../types/app";
import {
  MAX_FILE_UPLOAD_COUNT,
  MAX_FILE_UPLOAD_SIZE_BYTES,
  MAX_FILE_UPLOAD_SIZE_LABEL,
} from "../../file-tree/constants/constants";

const ATTACHMENTS_DIR = "attachments";

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export const sanitizeFileName = (name: string): string => {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const transliterated = base
    .split("")
    .map((char) => {
      const lower = char.toLowerCase();
      const mapped = TRANSLIT[lower];
      if (mapped === undefined) {
        return char;
      }
      return char === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    })
    .join("");
  const safeBase = transliterated
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeExt = ext.replace(/[^a-zA-Z0-9.]+/g, "");
  return (safeBase || "file") + safeExt;
};

/**
 * Dedup sanitized filenames within a batch so that collisions like
 * "тест.txt" → "test.txt" and "test.txt" → "test.txt" resolve to
 * ["test.txt", "test-2.txt"] instead of silently overwriting each other.
 */
export const deduplicateFileNames = (files: File[]): Map<File, string> => {
  const result = new Map<File, string>();
  const usedLower = new Map<string, number>(); // case-insensitive counter

  for (const file of files) {
    const sanitized = sanitizeFileName(file.name);
    const dot = sanitized.lastIndexOf(".");
    const base = dot > 0 ? sanitized.slice(0, dot) : sanitized;
    const ext = dot > 0 ? sanitized.slice(dot) : "";

    const key = sanitized.toLowerCase();
    const count = usedLower.get(key) ?? 0;
    if (count === 0) {
      usedLower.set(key, 1);
      result.set(file, sanitized);
    } else {
      // Find next available suffix
      let suffix = count + 1;
      let candidate: string;
      do {
        candidate = `${base}-${suffix}${ext}`;
        suffix++;
      } while (usedLower.has(candidate.toLowerCase()));
      usedLower.set(candidate.toLowerCase(), 1);
      usedLower.set(key, suffix - 1);
      result.set(file, candidate);
    }
  }

  return result;
};

type UseChatFileAttachOptions = {
  selectedProject: Project | null;
  setInput: Dispatch<SetStateAction<string>>;
};

export const buildAttachmentMentions = (fileNames: string[]): string =>
  fileNames.map((name) => `@${ATTACHMENTS_DIR}/${name}`).join(" ");

export const appendMentions = (previous: string, mentions: string): string => {
  if (!mentions) return previous;
  if (!previous) return `${mentions} `;
  return `${previous.endsWith(" ") ? previous : `${previous} `}${mentions} `;
};

export function useChatFileAttach({ selectedProject, setInput }: UseChatFileAttachOptions) {
  const { t } = useTranslation("chat");
  const [isAttachingFiles, setIsAttachingFiles] = useState(false);
  const [fileAttachError, setFileAttachError] = useState<string | null>(null);

  const attachFiles = useCallback(
    async (files: File[]) => {
      if (!selectedProject || files.length === 0 || isAttachingFiles) {
        return;
      }

      setFileAttachError(null);

      if (files.length > MAX_FILE_UPLOAD_COUNT) {
        setFileAttachError(t("input.attachTooMany", { count: MAX_FILE_UPLOAD_COUNT }));
        return;
      }

      const oversized = files.filter((file) => file.size > MAX_FILE_UPLOAD_SIZE_BYTES);
      const validFiles = files.filter((file) => file.size <= MAX_FILE_UPLOAD_SIZE_BYTES);

      if (oversized.length > 0) {
        setFileAttachError(
          t("input.attachTooLarge", {
            files: oversized.map((file) => file.name).join(", "),
            limit: MAX_FILE_UPLOAD_SIZE_LABEL,
          }),
        );
      }

      if (validFiles.length === 0) {
        return;
      }

      // Fix #1: deduplicate sanitized names within the batch to prevent
      // silent overwrites (e.g. "тест.txt" and "test.txt" both → "test.txt")
      const nameMap = deduplicateFileNames(validFiles);

      const formData = new FormData();
      formData.append("targetPath", ATTACHMENTS_DIR);
      formData.append("requestedFileCount", String(validFiles.length));
      validFiles.forEach((file) => formData.append("files", file, nameMap.get(file)!));

      setIsAttachingFiles(true);
      try {
        const response = await api.uploadFiles(selectedProject.projectId, formData);
        const data = await response.json().catch(() => ({}));

        if (!response.ok || data.error) {
          setFileAttachError(
            data.error || t("input.attachUploadFailed", { status: response.status }),
          );
          return;
        }

        const uploadedNames: string[] = Array.isArray(data.files)
          ? data.files.map((file: { name?: string }) => file?.name).filter(Boolean)
          : [];

        if (uploadedNames.length === 0) {
          setFileAttachError(t("input.attachNoneSaved"));
          return;
        }

        setInput((previous) => appendMentions(previous, buildAttachmentMentions(uploadedNames)));
      } catch (error) {
        setFileAttachError(error instanceof Error ? error.message : t("input.attachUploadFailed", { status: "?" }));
      } finally {
        setIsAttachingFiles(false);
      }
    },
    [selectedProject, isAttachingFiles, setInput, t],
  );

  return { attachFiles, isAttachingFiles, fileAttachError };
}
