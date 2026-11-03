import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

export interface DocumentWorkspace {
  documentName: string;
  inputPath: string;
  outputDir: string;
  scriptPath: string;
}

function isSupportedFile(path: string): boolean {
  return (
    existsSync(path) &&
    statSync(path).isFile() &&
    SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase())
  );
}

function findDocumentInDirectory(directory: string): string | null {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return null;

  const directoryName = basename(directory);
  for (const extension of [".md", ".txt"]) {
    const preferred = join(directory, `${directoryName}${extension}`);
    if (isSupportedFile(preferred)) return preferred;
  }

  const files = readdirSync(directory)
    .map((name) => join(directory, name))
    .filter(isSupportedFile)
    .sort((left, right) => left.localeCompare(right, "vi"));
  if (files.length === 1) return files[0];
  if (files.length > 1) {
    throw new Error(
      `Document folder "${directory}" contains multiple .md/.txt files. ` +
        `Name the primary file after the folder or pass its exact path.`,
    );
  }
  return null;
}

export function safeDocumentFolderName(value: string): string {
  const safe = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return safe || "Tài liệu";
}

export function resolveDocumentWorkspace(
  input: string,
  cwd = process.cwd(),
): DocumentWorkspace {
  const inputRoot = resolve(cwd, "input");
  const directPath = resolve(cwd, input);
  const inputFolderPath = resolve(inputRoot, input);
  const candidates: string[] = [];

  if (isSupportedFile(directPath)) {
    candidates.push(directPath);
  } else {
    const directDirectoryFile = findDocumentInDirectory(directPath);
    if (directDirectoryFile) candidates.push(directDirectoryFile);
  }

  if (candidates.length === 0 && isSupportedFile(inputFolderPath)) {
    candidates.push(inputFolderPath);
  }
  if (candidates.length === 0) {
    const inputDirectoryFile = findDocumentInDirectory(inputFolderPath);
    if (inputDirectoryFile) candidates.push(inputDirectoryFile);
  }
  if (candidates.length === 0 && extname(input) === "") {
    for (const extension of [".md", ".txt"]) {
      const candidate = `${inputFolderPath}${extension}`;
      if (isSupportedFile(candidate)) candidates.push(candidate);
    }
  }

  const inputPath = candidates[0];
  if (!inputPath) {
    throw new Error(
      `Could not find document "${input}". Expected input/<document>/<document>.md ` +
        `or input/<document>/<document>.txt.`,
    );
  }

  const relativeToInput = relative(inputRoot, inputPath);
  const pathParts = relativeToInput.split(/[\\/]/).filter(Boolean);
  const isUnderInput = !relativeToInput.startsWith("..") && pathParts.length >= 2;
  const folderSegments = isUnderInput
    ? pathParts.slice(0, -1)
    : [basename(inputPath, extname(inputPath))];
  const documentName = isUnderInput
    ? folderSegments.join(" / ")
    : basename(inputPath, extname(inputPath));
  const outputDir = resolve(cwd, "output", ...folderSegments.map(safeDocumentFolderName));

  return {
    documentName,
    inputPath,
    outputDir,
    scriptPath: join(outputDir, "script.json"),
  };
}
