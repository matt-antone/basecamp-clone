import { Client } from "pg";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import slugify from "slugify";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

marked.setOptions({ gfm: true, breaks: true });

const shouldWipeProjects = process.argv.some((arg) =>
  new Set(["--wipe", "--wipe-all", "--wipe-all-projects", "--reseed"]).has(arg)
);

const projectTemplates = [
  {
    name: "Website Refresh",
    status: "in_progress",
    tags: ["website", "design", "approval"],
    description: (client) =>
      `Refresh the ${client.name} marketing site with a clearer story, tighter navigation, and a launch plan the team can manage async.`,
    threads: [
      {
        title: "Homepage direction",
        body: (client) =>
          `Let's use this thread to land the homepage narrative for ${client.name}.\n\nWorking goals:\n- tighten the hero message\n- simplify the page flow\n- agree on the first round for review`,
        comments: [
          "I pulled the current homepage into a quick outline. The top section is trying to say three different things at once, so my vote is to lead with outcomes and keep the proof points lower on the page.",
          "That feels right. If we reduce the opening to one clear promise, I can rewrite the supporting copy into three short panels and keep the CTA focused on consultations instead of general contact.",
          "Perfect. I also want to trim the nav before we design the hero. Right now there are too many equally weighted choices, and it makes the whole page feel less confident than it should.",
          "I can post a revised nav proposal this afternoon. Once that is in, we should be able to sketch the hero and social proof blocks in one pass."
        ]
      },
      {
        title: "Navigation and content priorities",
        body: (client) =>
          `Need a quick decision on what belongs in primary navigation for ${client.name}.\n\nPlease react with:\n1. must keep\n2. can move to footer\n3. needs a better label`,
        comments: [
          "From the stakeholder notes, About, Services, Team, and Contact are the only pages that came up consistently. Everything else looks like it can be nested or moved lower in the experience.",
          "Agree. I would also rename News to Insights if we want that section to feel more current and less like an archive. The existing label makes it sound abandoned.",
          "Good call. Let's keep Insights in the footer for phase one and promote it later if content production becomes regular.",
          "Works for me. I will update the sitemap doc and mark the moved sections so we have a clean list for design review."
        ]
      },
      {
        title: "Pre-launch review checklist",
        body: (client) =>
          `Starting the pre-launch pass for ${client.name}.\n\nPlease add anything we should verify before we schedule handoff.`,
        comments: [
          "I want one round specifically for broken-link testing and mobile spacing. Those are the two issues most likely to slip when we start moving quickly toward launch.",
          "Adding accessibility review as well. We should confirm heading order, image alt text, and button labels before final approval instead of treating that as a cleanup task.",
          "Yes, and let's give the client a single review link with a short note on what feedback is still actionable. That should keep the last mile tighter.",
          "I will package that in the launch checklist and share a draft before end of day so we can use it as the handoff source of truth."
        ]
      }
    ]
  },
  {
    name: "Q2 Campaign",
    status: "blocked",
    tags: ["campaign", "copy", "launch"],
    description: (client) =>
      `Coordinate the ${client.name} Q2 campaign across creative, messaging, approvals, and rollout timing so the team can move quickly once direction is locked.`,
    threads: [
      {
        title: "Campaign theme shortlist",
        body: (client) =>
          `We need to narrow the Q2 theme for ${client.name}.\n\nCurrent options:\n- momentum\n- clarity\n- trusted partner\n\nPlease push back if one of these does not fit what we learned in discovery.`,
        comments: [
          "Momentum is strong, but I worry it sounds too internal. Trusted partner feels closer to what the client actually sells when we read through the discovery notes.",
          "I had the same reaction. Clarity could still work as a secondary idea, especially if we position the service as helping buyers make faster decisions with less noise.",
          "That gives us a nice split: trusted partner as the campaign spine, clarity as the emotional benefit. We can probably write the landing page from that alone.",
          "Let's move with that direction pending stakeholder signoff. I will prep two headline routes so approval can happen without reopening strategy."
        ]
      },
      {
        title: "Production timing and dependencies",
        body: (client) =>
          `Dropping the timing view here so we can call out blockers for ${client.name} before they surprise us later.`,
        comments: [
          "The main blocker is still photography. If we do not get selects this week, paid social creative is going to slip and we will be forcing layout with placeholder imagery.",
          "Understood. In parallel, I can keep the campaign skeleton moving with illustration-friendly comps so we are not fully stalled while waiting for photos.",
          "That's a good hedge. Let's also confirm whether legal needs to review the testimonial language, because that could affect the landing page timeline too.",
          "I will ask for that in today's client note. If legal is in play, we should keep the launch date soft until we have an actual turnaround window."
        ]
      },
      {
        title: "Launch sequence and ownership",
        body: (client) =>
          `Let's get explicit about who owns what in launch week for ${client.name} so nothing drifts.`,
        comments: [
          "I can own landing page QA and final copy lock. Once the page is live, I will hand channel-specific messaging back so distribution stays coordinated.",
          "I'll take asset exports, UTM verification, and scheduling support. I also want a short rollback checklist in case we need to swap copy after launch.",
          "Smart. Can you also add a same-day analytics spot check? Even a quick pass on form submissions and traffic sources would help us catch issues early.",
          "Absolutely. I will build that into the run-of-show and post the final owner grid once the remaining approvals come through."
        ]
      }
    ]
  }
];

function renderMarkdown(input) {
  const html = marked.parse(input, { async: false });
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title"]
    },
    allowedSchemes: ["http", "https", "mailto"]
  });
}

function addMinutes(value, minutes) {
  return new Date(value.getTime() + minutes * 60_000);
}

function getMember(profiles, index) {
  return profiles[index % profiles.length];
}

async function wipeProjects(db) {
  const before = await db.query(
    "select count(*)::int as projects, (select count(*)::int from discussion_threads) as threads, (select count(*)::int from discussion_comments) as comments from projects"
  );

  await db.query("delete from projects");

  return before.rows[0];
}

async function createProject({ db, client, template, createdBy, createdAt }) {
  const clientSlug =
    slugify(client.name, { lower: true, strict: true }) ||
    slugify(client.code, { lower: true, strict: true }) ||
    "client";
  const projectSlug = slugify(template.name, { lower: true, strict: true }) || "project";

  const result = await db.query(
    `with lock as (
       select pg_advisory_xact_lock(hashtext('project-seq:' || $4::text))
     ),
     next_seq as (
       select coalesce(max(project_seq), 0) + 1 as seq
       from projects
       where client_id = $4::uuid
         and exists(select 1 from lock)
     )
     insert into projects (
       name,
       slug,
       description,
       created_by,
       created_at,
       updated_at,
       client_id,
       status,
       project_seq,
       project_code,
       client_slug,
       project_slug,
       storage_project_dir,
       tags
     )
     select
       $1,
       lower($5 || '-' || lpad(next_seq.seq::text, 4, '0') || '-' || $7),
       $2,
       $3,
       $9,
       $9,
       $4::uuid,
       $8,
       next_seq.seq,
       $5 || '-' || lpad(next_seq.seq::text, 4, '0'),
       $6,
       $7,
       '/projects/' || $6 || '/' || ($5 || '-' || lpad(next_seq.seq::text, 4, '0')) || '-' || $7,
       $10::text[]
     from next_seq
     returning *`,
    [
      template.name,
      template.description(client),
      createdBy,
      client.id,
      client.code,
      clientSlug,
      projectSlug,
      template.status,
      createdAt.toISOString(),
      template.tags
    ]
  );

  return result.rows[0];
}

async function createDiscussion({ db, projectId, title, body, authorUserId, createdAt }) {
  const result = await db.query(
    `insert into discussion_threads (
      project_id,
      title,
      body_markdown,
      body_html,
      author_user_id,
      created_at,
      updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $6)
     returning *`,
    [projectId, title, body, renderMarkdown(body), authorUserId, createdAt.toISOString()]
  );

  return result.rows[0];
}

async function createComment({ db, projectId, threadId, body, authorUserId, createdAt }) {
  const result = await db.query(
    `insert into discussion_comments (
      project_id,
      thread_id,
      body_markdown,
      body_html,
      author_user_id,
      created_at,
      updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $6)
     returning *`,
    [projectId, threadId, body, renderMarkdown(body), authorUserId, createdAt.toISOString()]
  );

  return result.rows[0];
}

async function main() {
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    await db.query("begin");

    const profilesResult = await db.query(
      "select id, email, first_name, last_name from user_profiles order by created_at asc, email asc"
    );
    const clientsResult = await db.query("select id, name, code from clients order by name asc, code asc");

    if (profilesResult.rows.length === 0) {
      throw new Error("No user profiles found. Create at least one profile before seeding.");
    }

    if (clientsResult.rows.length === 0) {
      console.log("No clients found. Add clients first, then run this script again.");
      await db.query("rollback");
      return;
    }

    let deletedCounts = { projects: 0, threads: 0, comments: 0 };
    if (shouldWipeProjects) {
      deletedCounts = await wipeProjects(db);
    }

    let createdProjects = 0;
    let createdThreads = 0;
    let createdComments = 0;

    const profiles = profilesResult.rows;
    const clients = clientsResult.rows;
    const baseTime = new Date("2026-03-24T16:00:00.000Z");

    for (const [clientIndex, client] of clients.entries()) {
      for (const [templateIndex, template] of projectTemplates.entries()) {
        const projectAuthor = getMember(profiles, clientIndex + templateIndex);
        const projectCreatedAt = addMinutes(baseTime, clientIndex * 180 + templateIndex * 60);
        const project = await createProject({
          db,
          client,
          template,
          createdBy: projectAuthor.id,
          createdAt: projectCreatedAt
        });
        createdProjects += 1;

        for (const [threadIndex, threadTemplate] of template.threads.entries()) {
          const starter = getMember(profiles, clientIndex + templateIndex + threadIndex);
          const threadCreatedAt = addMinutes(projectCreatedAt, (threadIndex + 1) * 18);
          const thread = await createDiscussion({
            db,
            projectId: project.id,
            title: threadTemplate.title,
            body: threadTemplate.body(client),
            authorUserId: starter.id,
            createdAt: threadCreatedAt
          });
          createdThreads += 1;

          for (const [commentIndex, commentBody] of threadTemplate.comments.entries()) {
            const commenter = getMember(profiles, clientIndex + templateIndex + threadIndex + commentIndex + 1);
            const commentCreatedAt = addMinutes(threadCreatedAt, (commentIndex + 1) * 11);
            await createComment({
              db,
              projectId: project.id,
              threadId: thread.id,
              body: commentBody,
              authorUserId: commenter.id,
              createdAt: commentCreatedAt
            });
            createdComments += 1;
          }
        }
      }
    }

    await db.query("commit");

    console.log(
      JSON.stringify(
        {
          wiped: shouldWipeProjects,
          deleted: deletedCounts,
          clients: clients.length,
          profiles: profiles.length,
          createdProjects,
          createdThreads,
          createdComments
        },
        null,
        2
      )
    );
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
