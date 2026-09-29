/**
 * Tests for the dashboard strategy.
 *
 * Zero dependencies: node:test plus the module itself, which is plain ESM with no build step.
 * The registry fixtures mirror what Home Assistant returns for the ha-veeam-one integration:
 * translation keys, unique IDs of the form "<entry>_<key>", entity IDs built from the device
 * name plus the translated entity name, and the entity_category and platform fields the
 * layout depends on.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboard, buildSections, buildView } from "../veeam-one-dashboard.js";

const ENTRY = "01JENTRYONE";
const ENTRY_2 = "01JENTRYTWO";

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function device(id, name, model, entry = ENTRY, extra = {}) {
  return {
    id,
    name,
    name_by_user: null,
    model,
    manufacturer: "Veeam",
    config_entries: [entry],
    identifiers: [["veeam_one", id]],
    disabled_by: null,
    ...extra,
  };
}

/**
 * An entity as the integration registers it. `key` is the unique ID without the entry prefix;
 * the entity ID is slug(device name) + "_" + slug(entity name), as Home Assistant builds it.
 */
function entity(domain, dev, key, translationKey, name, extra = {}) {
  const entry = dev.config_entries[0];
  return {
    entity_id: `${domain}.${slug(dev.name)}_${slug(name)}`,
    device_id: dev.id,
    config_entry_id: entry,
    platform: "veeam_one",
    unique_id: `${entry}_${key}`,
    translation_key: translationKey,
    has_entity_name: true,
    name: null,
    original_name: name,
    entity_category: null,
    disabled_by: null,
    hidden_by: null,
    ...extra,
  };
}

const DIAGNOSTIC = { entity_category: "diagnostic" };
const DISABLED = { disabled_by: "integration" };

/** The Veeam ONE server device and everything the integration puts on it. */
function serverEntities(server) {
  const e = (domain, key, tk, name, extra) => entity(domain, server, key, tk, name, extra);
  return [
    e("binary_sensor", "connected", "connected", "Connected"),
    e("sensor", "version", "version", "Version", DIAGNOSTIC),
    e("sensor", "active_alarms", "active_alarms", "Active alarms"),
    e("sensor", "error_alarms", "error_alarms", "Error alarms"),
    e("sensor", "warning_alarms", "warning_alarms", "Warning alarms"),
    e("sensor", "license_type", "license_type", "License type", DIAGNOSTIC),
    e("sensor", "license_package", "license_package", "License package", DIAGNOSTIC),
    e("sensor", "license_company", "license_company", "License company", DIAGNOSTIC),
    e("sensor", "license_instances", "license_instances", "Licensed instances", DIAGNOSTIC),
    e("sensor", "license_sockets", "license_sockets", "Licensed sockets", {
      ...DIAGNOSTIC,
      ...DISABLED,
    }),
    e("sensor", "license_expiration_days", "license_days_remaining", "License days remaining"),
    e(
      "sensor",
      "license_support_expiration_days",
      "license_support_days_remaining",
      "License support days remaining",
    ),
    e("binary_sensor", "license_expired", "license_expired", "License expired"),
    e(
      "binary_sensor",
      "license_support_expired",
      "license_support_expired",
      "License support expired",
    ),
    e("sensor", "license_instances_used", "license_unit_used", "License Instances used"),
    e(
      "sensor",
      "license_instances_licensed",
      "license_unit_licensed",
      "License Instances licensed",
    ),
    e(
      "sensor",
      "license_instances_percentage",
      "license_unit_used_percentage",
      "License Instances used percentage",
    ),
    ...collection(server, "jobs", "VBR Backup Jobs", true),
    ...collection(server, "repositories", "VBR Repositories", true),
    ...collection(server, "m365_backup_jobs", "Microsoft 365 Backup Jobs", true),
    ...collection(server, "m365_users", "Microsoft 365 Users", false),
    ...collection(server, "vsphere_vms", "vSphere VMs", false),
    ...collection(server, "hyperv_hosts", "Hyper-V Hosts", false),
  ];
}

/** A collection's count, and for collections with a status its health and problem sensors. */
function collection(server, key, label, withStatus) {
  const list = [entity("sensor", server, `${key}_count`, "collection_count", label)];
  if (withStatus) {
    list.push(
      entity("sensor", server, `${key}_health`, "collection_health", `${label} health`),
      entity("binary_sensor", server, `${key}_problem`, "collection_problem", `${label} problem`),
    );
  }
  return list;
}

/** A resource entity: unique ID "<entry>_<collection>_<object id>_<field>". */
function resource(domain, dev, collectionKey, objectId, field, tk, name, extra) {
  return entity(domain, dev, `${collectionKey}_${objectId}_${field}`, tk, name, extra);
}

function jobEntities(dev, key, id) {
  const r = (domain, field, tk, name, extra) =>
    resource(domain, dev, key, id, field, tk, name, extra);
  return [
    r("sensor", "status", "status", "Status"),
    r("binary_sensor", "problem", "problem", "Problem"),
    r("sensor", "lastRun", "last_run", "Last run"),
    r("sensor", "lastRunDurationSec", "last_run_duration", "Last run duration"),
    r("sensor", "avgDurationSec", "average_run_duration", "Average run duration", DIAGNOSTIC),
    r("sensor", "lastTransferredDataBytes", "last_transferred_data", "Last transferred data"),
  ];
}

function repositoryEntities(dev, key, id, withStatus = true) {
  const r = (domain, field, tk, name, extra) =>
    resource(domain, dev, key, id, field, tk, name, extra);
  return [
    ...(withStatus
      ? [
          r("sensor", "status", "status", "Status"),
          r("binary_sensor", "problem", "problem", "Problem"),
        ]
      : []),
    r("sensor", "capacityBytes", "capacity", "Capacity"),
    r("sensor", "freeSpaceBytes", "free_space", "Free space"),
    ...(withStatus ? [] : [r("sensor", "usedSpaceBytes", "used_space", "Used space")]),
    r("sensor", "free_percent", "free_space_percentage", "Free space percentage"),
    ...(withStatus
      ? [
          r("sensor", "outOfSpaceInDays", "days_until_out_of_space", "Days until out of space"),
          r("sensor", "runningTasks", "running_tasks", "Running tasks", DIAGNOSTIC),
        ]
      : []),
  ];
}

function statusEntities(dev, key, id) {
  return [
    resource("sensor", dev, key, id, "status", "status", "Status"),
    resource("binary_sensor", dev, key, id, "problem", "problem", "Problem"),
  ];
}

/** A registry set covering every device model the integration creates. */
function registries({ entry = ENTRY, suffix = "" } = {}) {
  const d = (id, name, model) => device(`${id}${suffix}`, name, model, entry);
  const server = d("server", "Veeam ONE", "Veeam ONE");
  const job = d("job-1", "Veeam ONE Nightly VMs", "VBR Backup Job");
  const job2 = d("job-2", "Veeam ONE Weekly Files", "VBR Backup Job");
  const replica = d("replica-1", "Veeam ONE DR Replica", "VBR Replication Job");
  const copy = d("copy-1", "Veeam ONE Offsite Copy", "VBR Backup Copy Job");
  const repo = d("repo-1", "Veeam ONE Default Backup Repository", "VBR Repository");
  const vbrServer = d("vbr-1", "Veeam ONE vbr01.example.com", "VBR Backup Server");
  const m365Job = d("m365-job-1", "Veeam ONE Mailboxes", "Microsoft 365 Backup Job");
  const m365Copy = d("m365-copy-1", "Veeam ONE Mailbox Archive", "Microsoft 365 Copy Job");
  const m365Repo = d("m365-repo-1", "Veeam ONE M365 Local", "Microsoft 365 Repository");
  const m365Object = d(
    "m365-object-1",
    "Veeam ONE Azure Blob",
    "Microsoft 365 Object Storage Repository",
  );
  const m365Server = d("m365-server-1", "Veeam ONE vb365.example.com", "Microsoft 365 Server");
  const m365Proxy = d("m365-proxy-1", "Veeam ONE proxy01", "Microsoft 365 Backup Proxy");

  return {
    entries: [
      {
        entry_id: entry,
        domain: "veeam_one",
        title: `Veeam ONE (${suffix ? "two" : "one"}.example.com)`,
      },
    ],
    devices: [
      server,
      job,
      job2,
      replica,
      copy,
      repo,
      vbrServer,
      m365Job,
      m365Copy,
      m365Repo,
      m365Object,
      m365Server,
      m365Proxy,
    ],
    entities: [
      ...serverEntities(server),
      ...jobEntities(job, "jobs", "1111"),
      ...jobEntities(job2, "jobs", "2222"),
      ...jobEntities(replica, "replication_jobs", "3333"),
      ...jobEntities(copy, "copy_jobs", "4444"),
      ...repositoryEntities(repo, "repositories", "5555"),
      ...statusEntities(vbrServer, "servers", "6666"),
      ...jobEntities(m365Job, "m365_backup_jobs", "7777"),
      resource(
        "sensor",
        m365Job,
        "m365_backup_jobs",
        "7777",
        "processedItems",
        "processed_items",
        "Processed items",
        DIAGNOSTIC,
      ),
      ...jobEntities(m365Copy, "m365_copy_jobs", "8888"),
      ...repositoryEntities(m365Repo, "m365_repositories", "9999", false),
      ...repositoryEntities(m365Object, "m365_object_storage", "aaaa", false),
      ...statusEntities(m365Server, "m365_servers", "bbbb"),
      ...statusEntities(m365Proxy, "m365_proxies", "cccc"),
    ],
  };
}

/** Two servers, each a config entry of its own with the same resources. */
function twoServers() {
  const one = registries();
  const two = registries({ entry: ENTRY_2, suffix: "-2" });
  return {
    entries: [...one.entries, ...two.entries],
    devices: [...one.devices, ...two.devices],
    entities: [
      ...one.entities,
      ...two.entities.map((e) => ({ ...e, entity_id: `${e.entity_id}_2` })),
    ],
  };
}

function headings(sections) {
  return sections.flatMap((s) => s.cards.filter((c) => c.type === "heading").map((c) => c.heading));
}

function entityCards(sections) {
  return sections.flatMap((s) => s.cards.filter((c) => c.entity));
}

function entityIdsIn(sections) {
  const ids = [];
  for (const card of sections.flatMap((s) => s.cards)) {
    if (card.entity) ids.push(card.entity);
    for (const member of card.entities || []) ids.push(member.entity);
  }
  return ids;
}

function sectionByHeading(sections, title) {
  return sections.find((s) => s.cards.some((c) => c.type === "heading" && c.heading === title));
}

function markdownIn(sections) {
  return sections.flatMap((s) =>
    s.cards.filter((c) => c.type === "markdown").map((c) => c.content),
  );
}

function summaryOf(data = registries(), config = {}) {
  return buildSections("overview", data, config)[0].cards[0].content;
}

// ---------------------------------------------------------------------------------------------
// Views are named
// ---------------------------------------------------------------------------------------------

test("a generated view names itself", () => {
  // Home Assistant applies the generated config over the view's own keys, so a view strategy
  // that returns no title renders as "Unnamed view"
  for (const group of [
    "overview",
    "alarms",
    "jobs",
    "repositories",
    "infrastructure",
    "inventory",
  ]) {
    const view = buildView(group, registries(), {});
    assert.ok(view.title, `${group} should have a title`);
    assert.ok(view.icon, `${group} should have an icon`);
    assert.ok(view.path, `${group} should have a path`);
  }
});

test("the title, icon and path can be set in the strategy config", () => {
  const view = buildView("alarms", registries(), {
    title: "Veeam alarms",
    icon: "mdi:bell",
    path: "veeam-alarms",
  });

  assert.equal(view.title, "Veeam alarms");
  assert.equal(view.icon, "mdi:bell");
  assert.equal(view.path, "veeam-alarms");
});

test("a dashboard keeps its per-view names even when a title is configured", () => {
  const dashboard = buildDashboard(registries(), { title: "Monitoring", path: "monitoring" });

  assert.deepEqual(
    dashboard.views.map((v) => v.title),
    ["Overview", "Alarms", "Jobs", "Repositories", "Infrastructure", "Inventory"],
  );
  assert.equal(new Set(dashboard.views.map((v) => v.path)).size, dashboard.views.length);
});

test("view settings pass through, and a view: block reaches the view verbatim", () => {
  const view = buildView("jobs", registries(), {
    theme: "midnight",
    background: "var(--blue)",
    subview: true,
    view: { top_margin: true },
  });

  assert.equal(view.theme, "midnight");
  assert.equal(view.background, "var(--blue)");
  assert.equal(view.subview, true);
  assert.equal(view.top_margin, true);
});

test("a view: block cannot replace the generated content", () => {
  const view = buildView("jobs", registries(), {
    view: { type: "masonry", sections: [], badges: [], cards: [] },
  });

  assert.equal(view.type, "sections");
  assert.ok(view.sections.length, "the strategy decides what is on the view");
});

test("a theme on the dashboard strategy reaches every view", () => {
  const dashboard = buildDashboard(registries(), { theme: "midnight" });

  assert.ok(dashboard.views.every((v) => v.theme === "midnight"));
});

test("builds a view per group", () => {
  const dashboard = buildDashboard(registries(), {});

  assert.deepEqual(
    dashboard.views.map((v) => v.path),
    ["overview", "alarms", "jobs", "repositories", "infrastructure", "inventory"],
  );
  for (const view of dashboard.views) {
    assert.equal(view.type, "sections", `${view.path} should be a sections view`);
    assert.ok(view.sections.length, `${view.path} should not be empty`);
  }
});

test("the column count is configurable and applied", () => {
  assert.equal(buildView("jobs", registries(), { columns: 2 }).max_columns, 2);
  assert.equal(buildView("jobs", registries(), {}).max_columns, 3);
});

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------

test("the overview shows one tile per resource device, named for it", () => {
  const sections = buildSections("overview", registries(), {}).slice(1);
  const names = entityCards(sections).map((c) => c.name);

  assert.equal(names.length, 12, "twelve resource devices, one tile each");
  assert.equal(new Set(names).size, names.length, "no two tiles carry the same label");
  assert.ok(names.includes("Nightly VMs"), "the 'Veeam ONE' prefix is dropped");
  assert.ok(!names.some((n) => n.startsWith("Veeam ONE")));
});

test("the overview sections run jobs, then repositories, then servers", () => {
  const sections = buildSections("overview", registries(), {}).slice(1);

  assert.deepEqual(headings(sections), [
    "Backup jobs",
    "Replication jobs",
    "Backup copy jobs",
    "Microsoft 365 backup jobs",
    "Microsoft 365 copy jobs",
    "Repositories",
    "Microsoft 365 repositories",
    "Microsoft 365 object storage",
    "Backup servers",
    "Microsoft 365 servers",
    "Microsoft 365 proxies",
  ]);
  for (const s of sections) assert.ok(s.cards[0].icon, "section headings carry an icon");
});

test("the overview leads a job with its Status, and a repository with its free space", () => {
  const cards = entityCards(buildSections("overview", registries(), {}));
  const byName = (name) => cards.find((c) => c.name === name).entity;

  assert.equal(byName("Nightly VMs"), "sensor.veeam_one_nightly_vms_status");
  assert.equal(byName("Mailboxes"), "sensor.veeam_one_mailboxes_status");
  assert.equal(
    byName("Default Backup Repository"),
    "sensor.veeam_one_default_backup_repository_free_space_percentage",
  );
  assert.equal(byName("M365 Local"), "sensor.veeam_one_m365_local_free_space_percentage");
  assert.equal(byName("proxy01"), "sensor.veeam_one_proxy01_status");
});

test("the server's Connected, Active alarms and License days remaining become badges", () => {
  const view = buildView("overview", registries(), {});

  assert.deepEqual(
    view.badges.map((b) => b.entity),
    [
      "binary_sensor.veeam_one_connected",
      "sensor.veeam_one_active_alarms",
      "sensor.veeam_one_license_days_remaining",
    ],
  );
  assert.deepEqual(
    view.badges.map((b) => b.name),
    ["Connected", "Active alarms", "License days remaining"],
  );
});

test("with badges off nothing is lost — the server comes back as a section", () => {
  const view = buildView("overview", registries(), { badges: false });

  assert.equal(view.badges, undefined);
  const server = sectionByHeading(view.sections, "Veeam ONE");
  assert.ok(server, "the Veeam ONE section takes the badges' place");
  assert.deepEqual(entityIdsIn([server]), [
    "binary_sensor.veeam_one_connected",
    "sensor.veeam_one_active_alarms",
    "sensor.veeam_one_license_days_remaining",
  ]);
});

// ---------------------------------------------------------------------------------------------
// Live summary
// ---------------------------------------------------------------------------------------------

test("the overview opens with a live summary spanning the full width", () => {
  const first = buildSections("overview", registries(), {})[0];

  assert.equal(first.cards[0].type, "markdown");
  assert.equal(first.column_span, 3);
  assert.match(first.cards[0].content, /\{%/, "a template, so it does not go stale");
});

test("the summary counts alarms from the server's own alarm sensors", () => {
  const content = summaryOf();

  assert.match(content, /'sensor\.veeam_one_active_alarms'/);
  assert.match(content, /'sensor\.veeam_one_error_alarms'/);
  assert.match(content, /'sensor\.veeam_one_warning_alarms'/);
  assert.match(content, /No active alarms/);
});

test("the summary counts the same Problem sensors the device sections show", () => {
  const data = registries();
  const content = summaryOf(data);
  const problems = data.entities.filter((e) => e.translation_key === "problem");

  assert.equal(problems.length, 10);
  for (const p of problems)
    assert.ok(content.includes(`'${p.entity_id}'`), `${p.entity_id} is counted`);
  assert.ok(
    !content.includes("binary_sensor.veeam_one_vbr_backup_jobs_problem"),
    "per-collection problem sensors would count every job twice",
  );
  assert.match(content, /"Nightly VMs"/, "problems are named for their device");
});

test("the free-space and out-of-space thresholds reach the summary", () => {
  const content = summaryOf(registries(), { free_space_warn_at: 22, out_of_space_warn_days: 3 });

  assert.match(content, /v < 22/);
  assert.match(content, /below 22% free/);
  assert.match(content, /v <= 3/);
  assert.match(content, /sensor\.veeam_one_default_backup_repository_days_until_out_of_space/);
});

test("the license is raised when expired or within the warning window", () => {
  const content = summaryOf(registries(), { license_warn_days: 45 });

  assert.match(content, /binary_sensor\.veeam_one_license_expired/);
  assert.match(content, /days < 45/);
  assert.match(content, /binary_sensor\.veeam_one_license_support_expired/);
  assert.match(content, /ha-alert alert-type="error" title="Veeam ONE license expired/);
});

test("a failed poll is raised above everything else", () => {
  const content = summaryOf();

  assert.ok(content.startsWith("{% set connected = ['binary_sensor.veeam_one_connected'] %}"));
  assert.match(content, /Veeam ONE is not answering/);
});

test("the summary can be turned off", () => {
  const first = buildSections("overview", registries(), { summary: false })[0];

  assert.notEqual(first.cards[0].type, "markdown");
});

test("a server reporting only its connection gets no headline", () => {
  const data = registries();
  data.entities = data.entities.filter(
    (e) => e.translation_key === "connected" || e.device_id !== "server",
  );
  data.entities = data.entities.filter((e) => e.device_id === "server");

  const sections = buildSections("overview", data, { badges: false });
  assert.ok(!markdownIn(sections).length, "Connected alone says nothing while things are fine");
});

test("every template opens and closes its blocks", () => {
  const dashboard = buildDashboard(registries(), {});
  const contents = dashboard.views.flatMap((v) => markdownIn(v.sections));
  assert.ok(contents.length > 3);

  for (const content of contents) {
    const count = (re) => (content.match(re) || []).length;
    assert.equal(count(/\{%-?\s*if\b/g), count(/\{%-?\s*endif\b/g), `if/endif in ${content}`);
    assert.equal(count(/\{%-?\s*for\b/g), count(/\{%-?\s*endfor\b/g), `for/endfor in ${content}`);
    assert.equal(count(/\{\{/g), count(/\}\}/g), `{{ }} in ${content}`);
    assert.equal(count(/\{%/g), count(/%\}/g), `{% %} in ${content}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------------------------

test("the alarms view shows the counts and the list from the alarms attribute", () => {
  const sections = buildSections("alarms", registries(), {});

  assert.equal(sections.length, 1);
  assert.deepEqual(headings(sections), ["Alarms"]);
  assert.deepEqual(entityIdsIn(sections), [
    "sensor.veeam_one_active_alarms",
    "sensor.veeam_one_error_alarms",
    "sensor.veeam_one_warning_alarms",
  ]);
  assert.deepEqual(
    entityCards(sections).map((c) => c.name),
    ["Active alarms", "Error alarms", "Warning alarms"],
  );

  const [table] = markdownIn(sections);
  assert.match(table, /state_attr\('sensor\.veeam_one_active_alarms', 'alarms'\)/);
  // The fields the integration puts on each alarm
  for (const field of ["a.status", "a.name", "a.object", "a.triggered", "a.id", "a.repeat_count"]) {
    assert.ok(table.includes(field), `the table shows ${field}`);
  }
  assert.match(table, /Showing the newest/, "the attribute is capped at 50");
});

test("the alarm list points at the resolve_alarm action", () => {
  const [table] = markdownIn(buildSections("alarms", registries(), {}));

  assert.match(table, /veeam_one\.resolve_alarm/);
  assert.match(table, /alarm_ids/);
  assert.ok(!table.includes("config_entry_id"), "one server needs no config_entry_id");
});

test("with two servers, the alarm list says which config_entry_id to pass", () => {
  const sections = buildSections("alarms", twoServers(), {});

  assert.deepEqual(headings(sections), ["Alarms — one.example.com", "Alarms — two.example.com"]);
  const tables = markdownIn(sections);
  assert.match(tables[0], new RegExp(`config_entry_id: ${ENTRY}`));
  assert.match(tables[1], new RegExp(`config_entry_id: ${ENTRY_2}`));
});

test("the alarm table escapes pipes so a name cannot break a row", () => {
  const [table] = markdownIn(buildSections("alarms", registries(), {}));

  assert.match(table, /replace\('\|', '\/'\)/);
});

// ---------------------------------------------------------------------------------------------
// Device sections
// ---------------------------------------------------------------------------------------------

test("each job becomes its own section, VBR and Microsoft 365 alike", () => {
  const sections = buildSections("jobs", registries(), {});

  assert.deepEqual(headings(sections), [
    "Nightly VMs",
    "Weekly Files",
    "DR Replica",
    "Offsite Copy",
    "Mailboxes",
    "Mailbox Archive",
  ]);
});

test("a job section leads with Status and Problem, then groups its last run", () => {
  const section = sectionByHeading(buildSections("jobs", registries(), {}), "Nightly VMs");
  const [, status, problem, lastRun, row] = section.cards;

  assert.equal(status.entity, "sensor.veeam_one_nightly_vms_status");
  assert.equal(status.name, "Status", "short names inside a device section");
  assert.equal(problem.entity, "binary_sensor.veeam_one_nightly_vms_problem");
  assert.equal(lastRun.entity, "sensor.veeam_one_nightly_vms_last_run");
  assert.equal(row.type, "glance");
  assert.equal(row.title, "Last run");
  assert.deepEqual(
    row.entities.map((m) => m.name),
    ["Duration", "Transferred"],
  );
});

test("diagnostic entities are left out by default, and can be opted into", () => {
  const off = entityIdsIn(buildSections("jobs", registries(), {}));
  const on = entityIdsIn(buildSections("jobs", registries(), { include_diagnostics: true }));

  assert.ok(!off.includes("sensor.veeam_one_nightly_vms_average_run_duration"));
  assert.ok(on.includes("sensor.veeam_one_nightly_vms_average_run_duration"));
  assert.ok(on.includes("sensor.veeam_one_mailboxes_processed_items"));
  const row = sectionByHeading(
    buildSections("jobs", registries(), { include_diagnostics: true }),
    "Mailboxes",
  ).cards.find((c) => c.type === "glance");
  assert.deepEqual(
    row.entities.map((m) => m.name),
    ["Duration", "Transferred", "Items"],
  );
});

test("free space is a gauge at the top of a repository section, red when low", () => {
  const section = sectionByHeading(
    buildSections("repositories", registries(), {}),
    "Default Backup Repository",
  );
  const gauge = section.cards[1];

  assert.equal(gauge.type, "gauge");
  assert.equal(gauge.entity, "sensor.veeam_one_default_backup_repository_free_space_percentage");
  assert.equal(gauge.name, "Free space");
  assert.deepEqual(gauge.severity, { red: 0, yellow: 5, green: 15 });
});

test("the gauge thresholds follow free_space_warn_at", () => {
  const [section] = buildSections("repositories", registries(), { free_space_warn_at: 30 });

  assert.deepEqual(section.cards[1].severity, { red: 0, yellow: 20, green: 30 });
});

test("capacity, free and used space share one row", () => {
  const section = sectionByHeading(buildSections("repositories", registries(), {}), "M365 Local");
  const row = section.cards.find((c) => c.type === "glance");

  assert.equal(row.title, "Space");
  assert.deepEqual(
    row.entities.map((m) => m.name),
    ["Capacity", "Free", "Used"],
  );
});

test("repositories cover VBR, Microsoft 365 and object storage", () => {
  assert.deepEqual(headings(buildSections("repositories", registries(), {})), [
    "Default Backup Repository",
    "M365 Local",
    "Azure Blob",
  ]);
});

test("a renamed entity keeps the name the user gave it", () => {
  const data = registries();
  data.entities.find((e) => e.entity_id === "sensor.veeam_one_nightly_vms_status").name = "Result";

  const section = sectionByHeading(buildSections("jobs", data, {}), "Nightly VMs");
  assert.equal(section.cards[1].name, "Result");
});

test("an entity with no registry name falls back to its object id, minus the device", () => {
  const data = registries();
  const status = data.entities.find((e) => e.entity_id === "sensor.veeam_one_nightly_vms_status");
  status.original_name = null;

  const section = sectionByHeading(buildSections("jobs", data, {}), "Nightly VMs");
  assert.equal(section.cards[1].name, "Status");
});

test("a user-renamed device uses the new name, as given", () => {
  const data = registries();
  data.devices.find((d) => d.id === "job-1").name_by_user = "Veeam ONE Critical VMs";

  assert.ok(headings(buildSections("jobs", data, {})).includes("Veeam ONE Critical VMs"));
});

// ---------------------------------------------------------------------------------------------
// Infrastructure: servers, proxies, the Veeam ONE server and its license
// ---------------------------------------------------------------------------------------------

test("infrastructure covers servers, proxies, Veeam ONE and its licensing", () => {
  assert.deepEqual(headings(buildSections("infrastructure", registries(), {})), [
    "vbr01.example.com",
    "vb365.example.com",
    "proxy01",
    "Veeam ONE",
    "Licensing",
  ]);
});

test("the Veeam ONE section shows Connected and Version, though Version is diagnostic", () => {
  const section = sectionByHeading(buildSections("infrastructure", registries(), {}), "Veeam ONE");

  assert.deepEqual(entityIdsIn([section]), [
    "binary_sensor.veeam_one_connected",
    "sensor.veeam_one_version",
  ]);
  const [note] = markdownIn([section]);
  assert.ok(note, "a note explains a failed poll");
  const card = section.cards.find((c) => c.type === "markdown");
  assert.deepEqual(card.visibility, [
    { condition: "state", entity: "binary_sensor.veeam_one_connected", state: "off" },
  ]);
});

test("licensing shows expiry, what the license is, and each unit's use", () => {
  const section = sectionByHeading(buildSections("infrastructure", registries(), {}), "Licensing");
  const ids = entityIdsIn([section]);

  for (const id of [
    "sensor.veeam_one_license_days_remaining",
    "sensor.veeam_one_license_support_days_remaining",
    "binary_sensor.veeam_one_license_expired",
    "binary_sensor.veeam_one_license_support_expired",
    "sensor.veeam_one_license_type",
    "sensor.veeam_one_license_package",
    "sensor.veeam_one_licensed_instances",
    "sensor.veeam_one_license_instances_used_percentage",
    "sensor.veeam_one_license_instances_used",
    "sensor.veeam_one_license_instances_licensed",
  ]) {
    assert.ok(ids.includes(id), `${id} is on the Licensing section`);
  }
  assert.ok(!ids.includes("sensor.veeam_one_license_company"), "company is only a diagnostic");
  assert.ok(!ids.includes("sensor.veeam_one_licensed_sockets"), "disabled by default");

  const gauge = section.cards.find((c) => c.type === "gauge");
  assert.equal(gauge.name, "Instances used");
  assert.deepEqual(gauge.severity, { green: 0, yellow: 90, red: 100 });
  const row = section.cards.find((c) => c.type === "glance");
  assert.equal(row.title, "Instances");
  assert.deepEqual(
    row.entities.map((m) => m.name),
    ["Used", "Licensed"],
  );
});

test("the license banners show only while they apply", () => {
  const section = sectionByHeading(
    buildSections("infrastructure", registries(), { license_warn_days: 60 }),
    "Licensing",
  );
  const banners = section.cards.filter((c) => c.type === "markdown");

  assert.deepEqual(banners[0].visibility, [
    { condition: "state", entity: "binary_sensor.veeam_one_license_expired", state: "on" },
  ]);
  assert.deepEqual(banners[1].visibility, [
    {
      condition: "numeric_state",
      entity: "sensor.veeam_one_license_days_remaining",
      below: 60,
      above: -1,
    },
  ]);
});

test("a server entity no section claims still appears on the Veeam ONE section", () => {
  const data = registries();
  const server = data.devices.find((d) => d.id === "server");
  data.entities.push(entity("sensor", server, "something_new", "something_new", "Something new"));

  const section = sectionByHeading(buildSections("infrastructure", data, {}), "Veeam ONE");
  assert.ok(entityIdsIn([section]).includes("sensor.veeam_one_something_new"));
});

// ---------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------

test("the inventory has a section per monitored platform, in a fixed order", () => {
  assert.deepEqual(headings(buildSections("inventory", registries(), {})), [
    "Backup & Replication",
    "Microsoft 365",
    "VMware vSphere",
    "Hyper-V",
  ]);
});

test("a platform section counts its collections, then shows their problem and health", () => {
  const section = sectionByHeading(
    buildSections("inventory", registries(), {}),
    "Backup & Replication",
  );
  const [, counts, jobsProblem, reposProblem, health] = section.cards;

  assert.equal(counts.type, "glance");
  assert.equal(counts.title, "Monitored");
  assert.deepEqual(
    counts.entities.map((m) => [m.entity, m.name]),
    [
      ["sensor.veeam_one_vbr_backup_jobs", "Backup jobs"],
      ["sensor.veeam_one_vbr_repositories", "Repositories"],
    ],
  );
  assert.equal(jobsProblem.entity, "binary_sensor.veeam_one_vbr_backup_jobs_problem");
  assert.equal(jobsProblem.name, "Backup jobs");
  assert.equal(reposProblem.name, "Repositories");
  assert.equal(health.title, "Health");
  assert.deepEqual(
    health.entities.map((m) => m.entity),
    ["sensor.veeam_one_vbr_backup_jobs_health", "sensor.veeam_one_vbr_repositories_health"],
  );
});

test("a collection the dashboard does not know goes under Other, with its own name", () => {
  const data = registries();
  const server = data.devices.find((d) => d.id === "server");
  data.entities.push(...collection(server, "future_things", "Future Things", true));

  const other = sectionByHeading(buildSections("inventory", data, {}), "Other");
  assert.ok(other);
  assert.deepEqual(
    other.cards.slice(1).map((c) => c.name || c.entities.map((m) => m.name).join()),
    ["Future Things", "Future Things", "Future Things"],
  );
});

// ---------------------------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------------------------

test("entities from other integrations are ignored, the other Veeam ones included", () => {
  const data = registries();
  data.devices.push(device("br-job", "VBR Job Nightly VMs", "Backup Job", "br-entry"));
  data.entities.push({
    ...entity("sensor", data.devices.at(-1), "x_last_result", "job_last_result", "Last Result"),
    platform: "veeam_br",
  });

  const ids = buildDashboard(data, {}).views.flatMap((v) => entityIdsIn(v.sections));
  assert.ok(!ids.some((id) => id.startsWith("sensor.vbr_job")));
});

test("disabled and hidden entities are skipped; hidden ones can be opted into", () => {
  const data = registries();
  data.entities.find((e) => e.entity_id === "sensor.veeam_one_nightly_vms_last_run").disabled_by =
    "user";
  data.entities.find((e) => e.entity_id === "sensor.veeam_one_nightly_vms_status").hidden_by =
    "user";

  const ids = entityIdsIn(buildSections("jobs", data, {}));
  assert.ok(!ids.includes("sensor.veeam_one_nightly_vms_last_run"));
  assert.ok(!ids.includes("sensor.veeam_one_nightly_vms_status"));

  const withHidden = entityIdsIn(buildSections("jobs", data, { include_hidden: true }));
  assert.ok(withHidden.includes("sensor.veeam_one_nightly_vms_status"));
  assert.ok(!withHidden.includes("sensor.veeam_one_nightly_vms_last_run"), "disabled never");
});

test("a disabled device is skipped, and one with no usable entities has no section", () => {
  const data = registries();
  data.devices.find((d) => d.id === "job-1").disabled_by = "user";
  for (const e of data.entities.filter((e) => e.device_id === "job-2")) e.disabled_by = "user";

  const names = headings(buildSections("jobs", data, {}));
  assert.ok(!names.includes("Nightly VMs"));
  assert.ok(!names.includes("Weekly Files"));
});

// ---------------------------------------------------------------------------------------------
// Identifying entities
// ---------------------------------------------------------------------------------------------

test("the translation key decides over a misleading entity ID", () => {
  const data = registries();
  const status = data.entities.find((e) => e.entity_id === "sensor.veeam_one_nightly_vms_status");
  status.entity_id = "sensor.my_job_thing";

  const tile = entityCards(buildSections("overview", data, {})).find(
    (c) => c.name === "Nightly VMs",
  );
  assert.equal(tile.entity, "sensor.my_job_thing");
});

test("the unique ID is used when there is no translation key", () => {
  const data = registries();
  for (const e of data.entities) {
    e.translation_key = null;
    e.entity_id = `${e.entity_id.split(".")[0]}.renamed_${e.unique_id.toLowerCase()}`;
  }

  const view = buildView("overview", data, {});
  assert.deepEqual(
    view.badges.map((b) => b.entity),
    [
      `binary_sensor.renamed_${ENTRY.toLowerCase()}_connected`,
      `sensor.renamed_${ENTRY.toLowerCase()}_active_alarms`,
      `sensor.renamed_${ENTRY.toLowerCase()}_license_expiration_days`,
    ],
  );
  const counts = sectionByHeading(buildSections("inventory", data, {}), "Microsoft 365").cards[1];
  assert.deepEqual(
    counts.entities.map((m) => m.name),
    ["Backup jobs", "Users"],
  );
});

test("the entity ID is the last resort, ignoring a collision suffix", () => {
  const data = registries();
  for (const e of data.entities) {
    e.translation_key = null;
    e.unique_id = null;
    e.entity_id = `${e.entity_id}_2`;
  }

  const view = buildView("overview", data, {});
  assert.deepEqual(
    view.badges.map((b) => b.entity),
    [
      "binary_sensor.veeam_one_connected_2",
      "sensor.veeam_one_active_alarms_2",
      "sensor.veeam_one_license_days_remaining_2",
    ],
  );
});

// ---------------------------------------------------------------------------------------------
// Several servers
// ---------------------------------------------------------------------------------------------

test("with one server, section titles are not suffixed", () => {
  const names = headings(buildSections("infrastructure", registries(), {}));

  assert.ok(names.includes("Veeam ONE"));
  assert.ok(!names.some((n) => n.includes("—")));
});

test("with two servers, sections and tiles name the host from the config entry", () => {
  const data = twoServers();
  const infrastructure = headings(buildSections("infrastructure", data, {}));

  assert.ok(infrastructure.includes("Veeam ONE — one.example.com"));
  assert.ok(infrastructure.includes("Licensing — two.example.com"));
  assert.ok(headings(buildSections("jobs", data, {})).includes("Nightly VMs — two.example.com"));

  const names = entityCards(buildSections("overview", data, {})).map((c) => c.name);
  assert.ok(names.includes("Nightly VMs (one.example.com)"));
  assert.equal(new Set(names).size, names.length);
});

test("with two servers, badges say which server they describe", () => {
  const names = buildView("overview", twoServers(), {}).badges.map((b) => b.name);

  assert.ok(names.includes("Connected (one.example.com)"));
  assert.ok(names.includes("Active alarms (two.example.com)"));
});

test("with two servers, the headline counts both", () => {
  const content = summaryOf(twoServers());

  assert.match(content, /'sensor\.veeam_one_active_alarms', 'sensor\.veeam_one_active_alarms_2'/);
  assert.match(content, /"Nightly VMs on two.example.com"/);
});

test("a name the user gave the server device labels it instead of the host", () => {
  const data = twoServers();
  data.devices.find((d) => d.id === "server-2").name_by_user = "DR site";

  assert.ok(headings(buildSections("alarms", data, {})).includes("Alarms — DR site"));
});

test("without config entries to read, several servers still render", () => {
  const data = twoServers();
  delete data.entries;

  const names = headings(buildSections("infrastructure", data, {}));
  assert.equal(names.filter((n) => n === "Veeam ONE").length, 2);
});

// ---------------------------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------------------------

test("an empty system explains itself instead of rendering blank", () => {
  const dashboard = buildDashboard({ devices: [], entities: [] }, {});

  assert.equal(dashboard.views.length, 1);
  const content = dashboard.views[0].cards[0].content;
  assert.match(content, /No Veeam ONE entities found/);
  assert.match(content, /ha-veeam-one/, "should point at the integration that feeds it");
});

test("a system with only other integrations also gets the empty view", () => {
  const data = {
    devices: [device("x", "Light", "Bulb")],
    entities: [
      { ...entity("light", device("x", "Light", "Bulb"), "x", null, "Light"), platform: "hue" },
    ],
  };

  assert.match(buildDashboard(data, {}).views[0].cards[0].content, /No Veeam ONE entities found/);
});

test("views with nothing in them are dropped", () => {
  const data = registries();
  const keep = new Set(["server", "job-1"]);
  data.devices = data.devices.filter((d) => keep.has(d.id));
  data.entities = data.entities.filter(
    (e) => keep.has(e.device_id) && !(e.translation_key || "").startsWith("collection_"),
  );

  assert.deepEqual(
    buildDashboard(data, {}).views.map((v) => v.path),
    ["overview", "alarms", "jobs", "infrastructure"],
    "no repositories or collection counts means no empty tabs",
  );
});

test("an unknown group falls back to the overview", () => {
  const sections = buildSections("nonsense", registries(), {});

  assert.equal(headings(sections)[0], "Backup jobs");
});

test("every generated card names a card type", () => {
  const dashboard = buildDashboard(registries(), {});

  for (const view of dashboard.views) {
    for (const section of view.sections) {
      assert.equal(section.type, "grid");
      for (const card of section.cards) {
        assert.ok(card.type, `card without a type: ${JSON.stringify(card)}`);
      }
    }
  }
});

test("nothing generated depends on the current state of an entity", () => {
  // The strategy runs once per page load. A colour or an order derived from live states would
  // be a stale snapshot for the rest of the session.
  const json = JSON.stringify(buildDashboard(registries(), {}));

  for (const key of ['"color"', '"state_color"']) {
    assert.ok(!json.includes(key), `${key} would freeze a live state into the config`);
  }
});

test("only entities the fixture registers are referenced", () => {
  const data = registries();
  const known = new Set(data.entities.map((e) => e.entity_id));
  const dashboard = buildDashboard(data, { include_diagnostics: true });

  for (const view of dashboard.views) {
    for (const id of entityIdsIn(view.sections)) assert.ok(known.has(id), `unknown entity ${id}`);
    for (const badge of view.badges || []) assert.ok(known.has(badge.entity));
  }
});
