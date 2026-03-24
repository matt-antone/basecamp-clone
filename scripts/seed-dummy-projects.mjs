import { Client } from "pg";
import slugify from "slugify";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const SEED_USER = "seed-bot";

const projectTemplates = [
  {
    namePrefix: "Website Refresh",
    description: "Dummy project for planning redesign milestones and approvals.",
    status: "in_progress",
    threads: [
      {
        title: "Kickoff agenda",
        body:
          "Welcome team. This is a seeded discussion to align on scope, timeline, and owners.\n\n- Confirm goals\n- Review milestones\n- Capture blockers"
      },
      {
        title: "Weekly status updates",
        body:
          "Use this thread for quick async updates.\n\nPlease include:\n1. What changed this week\n2. Risks\n3. Help needed"
      }
    ]
  },
  {
    namePrefix: "Q2 Campaign",
    description: "Dummy project for campaign planning, assets, and launch checklist.",
    status: "new",
    threads: [
      {
        title: "Creative brief draft",
        body:
          "Seeded placeholder for discussing voice, audience, channels, and success metrics."
      },
      {
        title: "Launch readiness checklist",
        body:
          "Seeded checklist discussion.\n\n- Final copy approved\n- Assets exported\n- Tracking links validated"
      }
    ]
  }
];

function buildProjectName(namePrefix, code) {
  return `${namePrefix} (${code})`;
}

async function ensureProject(client, template, db) {
  const projectName = buildProjectName(template.namePrefix, client.code);
  const slug = slugify(projectName, { lower: true, strict: true });

  const existing = await db.query("select id from projects where slug = $1 limit 1", [slug]);
  if (existing.rows[0]?.id) {
    return { id: existing.rows[0].id, created: false, name: projectName };
  }

  const inserted = await db.query(
    `insert into projects (name, slug, description, created_by, client_id, status)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [projectName, slug, template.description, SEED_USER, client.id, template.status]
  );

  return { id: inserted.rows[0].id, created: true, name: projectName };
}

async function ensureDiscussion(projectId, threadTemplate, db) {
  const existing = await db.query(
    "select id from discussion_threads where project_id = $1 and title = $2 limit 1",
    [projectId, threadTemplate.title]
  );
  if (existing.rows[0]?.id) {
    return { id: existing.rows[0].id, created: false };
  }

  const inserted = await db.query(
    `insert into discussion_threads (project_id, title, body_markdown, body_html, author_user_id)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [projectId, threadTemplate.title, threadTemplate.body, `<p>${threadTemplate.body}</p>`, SEED_USER]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function main() {
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const clients = await db.query("select id, name, code from clients order by name asc");
    if (clients.rows.length === 0) {
      console.log("No clients found. Add clients first, then run this script again.");
      return;
    }

    let createdProjects = 0;
    let createdThreads = 0;

    for (const client of clients.rows) {
      for (const template of projectTemplates) {
        const project = await ensureProject(client, template, db);
        if (project.created) {
          createdProjects += 1;
        }

        for (const threadTemplate of template.threads) {
          const thread = await ensureDiscussion(project.id, threadTemplate, db);
          if (thread.created) {
            createdThreads += 1;
          }
        }
      }
    }

    console.log(
      `Seed complete. Clients: ${clients.rows.length}, projects created: ${createdProjects}, discussions created: ${createdThreads}`
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
