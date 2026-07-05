import { createTwoFilesPatch } from "diff";
import pc from "picocolors";
import type { EmittedFile, FileChange } from "./types.ts";

function colorize(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) return pc.green(line);
      if (line.startsWith("-") && !line.startsWith("---")) return pc.red(line);
      if (line.startsWith("@@")) return pc.cyan(line);
      return line;
    })
    .join("\n");
}

/** A colored unified diff for a modified file. */
export function renderDiff(change: FileChange): string {
  const patch = createTwoFilesPatch(
    change.path,
    change.path,
    change.before,
    change.after,
    undefined,
    undefined,
    { context: 3 },
  );
  return colorize(patch);
}

/** A colored unified diff for a newly created file. */
export function renderEmitted(file: EmittedFile): string {
  const patch = createTwoFilesPatch(
    "/dev/null",
    file.path,
    "",
    file.contents,
    undefined,
    undefined,
    { context: 3 },
  );
  return colorize(patch);
}
