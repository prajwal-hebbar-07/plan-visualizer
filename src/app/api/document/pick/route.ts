import { execFile } from "node:child_process";

export const runtime = "nodejs";

const PICKER_SCRIPT = `
set pickedFile to choose file with prompt "Choose a Markdown plan"
return POSIX path of pickedFile
`;

function chooseMacFile() {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", PICKER_SCRIPT],
      { encoding: "utf8", timeout: 120_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export async function POST() {
  if (process.platform !== "darwin") {
    return Response.json(
      { error: "The native file chooser currently requires macOS. Paste an absolute path instead." },
      { status: 501 },
    );
  }

  try {
    const selectedPath = await chooseMacFile();
    if (!selectedPath) return new Response(null, { status: 204 });
    return Response.json({ path: selectedPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel|canceled|-128/i.test(message)) {
      return new Response(null, { status: 204 });
    }
    return Response.json(
      { error: "The system file chooser could not be opened. Paste the absolute path instead." },
      { status: 500 },
    );
  }
}
