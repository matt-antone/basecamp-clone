// tests/support/dump-fixture.ts
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

export async function makeFixtureDump(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bc2-fix-"));
  await fs.writeFile(
    path.join(dir, "people.json"),
    JSON.stringify([{ id: 1, email_address: "a@b.com", name: "Alice" }]),
  );
  await fs.mkdir(path.join(dir, "projects"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "projects", "active.json"),
    JSON.stringify([{ id: 1001, name: "ALG-001: Test", archived: false }]),
  );
  await fs.writeFile(path.join(dir, "projects", "archived.json"), JSON.stringify([]));
  const projectDir = path.join(dir, "by-project", "1001");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "topics.json"),
    JSON.stringify([{ id: 5, title: "Hello", topicable: { id: 50, type: "Message" } }]),
  );
  await fs.mkdir(path.join(projectDir, "messages"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "messages", "50.json"),
    JSON.stringify({
      id: 50,
      subject: "Hello",
      content: "<p>hi</p>",
      creator: { id: 1 },
      comments: [{ id: 60, content: "<p>reply</p>", creator: { id: 1 } }],
    }),
  );
  await fs.writeFile(path.join(projectDir, "attachments.json"), JSON.stringify([]));
  return dir;
}
