/**
 * Veeam ONE dashboard strategy.
 *
 * Builds a dashboard from whatever the ha-veeam-one integration has created, so there is
 * nothing to maintain by hand as jobs, repositories and alarms come and go.
 *
 * Dashboard:
 *   strategy:
 *     type: custom:veeam-one
 *
 * A single view inside an existing dashboard:
 *   views:
 *     - strategy:
 *         type: custom:veeam-one
 *         group: alarms
 *         title: Veeam alarms
 *
 * Options (all optional):
 *   group                 Only for the view strategy: overview | alarms | jobs | repositories |
 *                         infrastructure (the backup servers, Microsoft 365 servers and proxies,
 *                         the Veeam ONE server and its licensing) | inventory (what Veeam ONE
 *                         counts on each platform, and each collection's health). Defaults to
 *                         overview.
 *   title, icon, path     Name the generated view. A view strategy has to supply these
 *   theme, background     itself: Home Assistant applies the generated config over the view's
 *   subview, visible      own keys, so a title set beside `strategy:` is ignored, and renaming
 *                         a strategy view in the visual editor replaces the strategy with
 *                         static cards. Set them here instead.
 *   view                  Any other view setting, passed through verbatim:
 *                           view:
 *                             theme: my-theme
 *   summary               Live headline: connection, alarms, resources reporting a problem,
 *                         repositories low on space and the license. Default true.
 *   badges                Connected, Active alarms and License days remaining as badges along
 *                         the top of the overview instead of a section. Default true.
 *   columns               Maximum section columns. Default 3.
 *   include_diagnostics   Include diagnostic entities. Default false. The Version and the
 *                         license type, package and instance count are shown regardless: the
 *                         Veeam ONE and Licensing sections are built around them.
 *   include_hidden        Include entities the user hid. Default false: hiding something and
 *                         having it reappear is not what anyone means.
 *   free_space_warn_at    Free-space percentage below which a repository is low. Default 15.
 *   out_of_space_warn_days  Days until out of space at or below which a repository is raised in
 *                         the headline. Default 7.
 *   license_warn_days     License days remaining below which the headline warns. Default 30,
 *                         when the integration raises its own repair issue.
 *   license_warn_at       License unit used percentage treated as a warning. Default 90.
 */

const INTEGRATION = "veeam_one";

/** Device models set by the integration. The server's model is its product name. */
const MODEL = {
  SERVER: "Veeam ONE",
  VBR_JOB: "VBR Backup Job",
  VBR_REPLICATION_JOB: "VBR Replication Job",
  VBR_COPY_JOB: "VBR Backup Copy Job",
  VBR_REPOSITORY: "VBR Repository",
  VBR_SERVER: "VBR Backup Server",
  M365_JOB: "Microsoft 365 Backup Job",
  M365_COPY_JOB: "Microsoft 365 Copy Job",
  M365_REPOSITORY: "Microsoft 365 Repository",
  M365_OBJECT_STORAGE: "Microsoft 365 Object Storage Repository",
  M365_SERVER: "Microsoft 365 Server",
  M365_PROXY: "Microsoft 365 Backup Proxy",
};

/** Section heading and icon per resource model, in the order they should appear. */
const MODEL_DISPLAY = [
  [MODEL.VBR_JOB, "Backup jobs", "mdi:backup-restore"],
  [MODEL.VBR_REPLICATION_JOB, "Replication jobs", "mdi:swap-horizontal"],
  [MODEL.VBR_COPY_JOB, "Backup copy jobs", "mdi:content-copy"],
  [MODEL.M365_JOB, "Microsoft 365 backup jobs", "mdi:microsoft"],
  [MODEL.M365_COPY_JOB, "Microsoft 365 copy jobs", "mdi:content-duplicate"],
  [MODEL.VBR_REPOSITORY, "Repositories", "mdi:database"],
  [MODEL.M365_REPOSITORY, "Microsoft 365 repositories", "mdi:database-outline"],
  [MODEL.M365_OBJECT_STORAGE, "Microsoft 365 object storage", "mdi:bucket-outline"],
  [MODEL.VBR_SERVER, "Backup servers", "mdi:server"],
  [MODEL.M365_SERVER, "Microsoft 365 servers", "mdi:server-outline"],
  [MODEL.M365_PROXY, "Microsoft 365 proxies", "mdi:server-network"],
];

const MODEL_ICON = new Map(MODEL_DISPLAY.map(([model, , icon]) => [model, icon]));
const MODEL_TITLE = new Map(MODEL_DISPLAY.map(([model, title]) => [model, title]));
const MODEL_ORDER = MODEL_DISPLAY.map(([model]) => model);

const JOB_MODELS = [
  MODEL.VBR_JOB,
  MODEL.VBR_REPLICATION_JOB,
  MODEL.VBR_COPY_JOB,
  MODEL.M365_JOB,
  MODEL.M365_COPY_JOB,
];
const REPOSITORY_MODELS = [MODEL.VBR_REPOSITORY, MODEL.M365_REPOSITORY, MODEL.M365_OBJECT_STORAGE];
const INFRASTRUCTURE_MODELS = [MODEL.VBR_SERVER, MODEL.M365_SERVER, MODEL.M365_PROXY];

const SERVER_ICON = "mdi:monitor-dashboard";

const GROUPS = ["overview", "alarms", "jobs", "repositories", "infrastructure", "inventory"];

const GROUP_VIEW = {
  overview: { title: "Overview", path: "overview", icon: SERVER_ICON },
  alarms: { title: "Alarms", path: "alarms", icon: "mdi:alarm-light" },
  jobs: { title: "Jobs", path: "jobs", icon: "mdi:file-tree" },
  repositories: { title: "Repositories", path: "repositories", icon: "mdi:database" },
  infrastructure: { title: "Infrastructure", path: "infrastructure", icon: "mdi:server" },
  inventory: { title: "Inventory", path: "inventory", icon: "mdi:format-list-numbered" },
};

const DEFAULTS = {
  summary: true,
  badges: true,
  columns: 3,
  include_diagnostics: false,
  include_hidden: false,
  free_space_warn_at: 15,
  out_of_space_warn_days: 7,
  license_warn_days: 30,
  license_warn_at: 90,
};

/**
 * Every device name starts with the product: the server is "Veeam ONE", a job "Veeam ONE
 * Nightly VMs". Under a heading of "Backup jobs" the title should read "Nightly VMs".
 */
const DEVICE_PREFIX = /^Veeam ONE\s+/i;

/**
 * The entities the layout looks for by meaning.
 *
 * An entity is identified, in order of trust, by:
 *   keys  its translation key, which the integration sets on every entity
 *   uid   a pattern for its unique ID with the config entry ID in front taken off — the
 *         integration builds them as "<entry>_<key>", and a resource's as
 *         "<entry>_<collection>_<object id>_<field>"
 *   eid   a suffix of its entity ID, ignoring a trailing "_2" that Home Assistant adds on
 *         collision
 *
 * The first identifier the entity actually carries decides; a later one is only a fallback for
 * registries that do not report the earlier one.
 *
 *   domain  when set, only entities of that domain qualify: a collection's Problem and a
 *           resource's Problem are binary sensors, and nothing else of the same name is
 *
 * Roles are always looked up within one device's entities, so the server's per-collection
 * "_problem" sensors are never taken for a resource's.
 */
const ROLE = {
  // The Veeam ONE server device
  CONNECTED: {
    keys: ["connected"],
    uid: /^connected$/,
    eid: ["_connected"],
    domain: "binary_sensor",
  },
  VERSION: { keys: ["version"], uid: /^version$/, eid: ["_version"] },
  ACTIVE_ALARMS: { keys: ["active_alarms"], uid: /^active_alarms$/, eid: ["_active_alarms"] },
  ERROR_ALARMS: { keys: ["error_alarms"], uid: /^error_alarms$/, eid: ["_error_alarms"] },
  WARNING_ALARMS: { keys: ["warning_alarms"], uid: /^warning_alarms$/, eid: ["_warning_alarms"] },

  LICENSE_EXPIRED: {
    keys: ["license_expired"],
    uid: /^license_expired$/,
    eid: ["_license_expired"],
    domain: "binary_sensor",
  },
  SUPPORT_EXPIRED: {
    keys: ["license_support_expired"],
    uid: /^license_support_expired$/,
    eid: ["_license_support_expired"],
    domain: "binary_sensor",
  },
  LICENSE_DAYS: {
    keys: ["license_days_remaining"],
    uid: /^license_expiration_days$/,
    eid: ["_license_days_remaining"],
  },
  SUPPORT_DAYS: {
    keys: ["license_support_days_remaining"],
    uid: /^license_support_expiration_days$/,
    eid: ["_license_support_days_remaining"],
  },
  LICENSE_TYPE: { keys: ["license_type"], uid: /^license_type$/, eid: ["_license_type"] },
  LICENSE_PACKAGE: {
    keys: ["license_package"],
    uid: /^license_package$/,
    eid: ["_license_package"],
  },
  LICENSE_COMPANY: {
    keys: ["license_company"],
    uid: /^license_company$/,
    eid: ["_license_company"],
  },
  LICENSE_INSTANCES: {
    keys: ["license_instances"],
    uid: /^license_instances$/,
    eid: ["_licensed_instances"],
  },
  LICENSE_SOCKETS: {
    keys: ["license_sockets"],
    uid: /^license_sockets$/,
    eid: ["_licensed_sockets"],
  },
  // One of each per license unit (Instances, Sockets, Points), named "License <unit> used" etc.
  UNIT_USED: { keys: ["license_unit_used"], uid: /^license_.+_used$/, eid: [], domain: "sensor" },
  UNIT_LICENSED: {
    keys: ["license_unit_licensed"],
    uid: /^license_.+_licensed$/,
    eid: [],
    domain: "sensor",
  },
  UNIT_PERCENT: {
    keys: ["license_unit_used_percentage"],
    uid: /^license_.+_percentage$/,
    eid: [],
    domain: "sensor",
  },

  // One of each per monitored collection that has returned resources
  COLLECTION_COUNT: { keys: ["collection_count"], uid: /_count$/, eid: [], domain: "sensor" },
  COLLECTION_HEALTH: { keys: ["collection_health"], uid: /_health$/, eid: [], domain: "sensor" },
  COLLECTION_PROBLEM: {
    keys: ["collection_problem"],
    uid: /_problem$/,
    eid: [],
    domain: "binary_sensor",
  },

  // Resource devices. A field's sensor exists only when Veeam ONE returns the field
  STATUS: { keys: ["status"], uid: /_status$/, eid: ["_status"], domain: "sensor" },
  PROBLEM: { keys: ["problem"], uid: /_problem$/, eid: ["_problem"], domain: "binary_sensor" },
  LAST_RUN: { keys: ["last_run"], uid: /_lastRun$/, eid: ["_last_run"] },
  LAST_RUN_DURATION: {
    keys: ["last_run_duration"],
    uid: /_lastRunDurationSec$/,
    eid: ["_last_run_duration"],
  },
  AVERAGE_DURATION: {
    keys: ["average_run_duration"],
    uid: /_avgDurationSec$/,
    eid: ["_average_run_duration"],
  },
  TRANSFERRED: {
    keys: ["last_transferred_data"],
    uid: /_lastTransferredDataBytes$/,
    eid: ["_last_transferred_data"],
  },
  PROCESSED: { keys: ["processed_items"], uid: /_processedItems$/, eid: ["_processed_items"] },
  CAPACITY: { keys: ["capacity"], uid: /_capacityBytes$/, eid: ["_capacity"] },
  FREE_SPACE: { keys: ["free_space"], uid: /_freeSpaceBytes$/, eid: ["_free_space"] },
  USED_SPACE: { keys: ["used_space"], uid: /_usedSpaceBytes$/, eid: ["_used_space"] },
  RUNNING_TASKS: { keys: ["running_tasks"], uid: /_runningTasks$/, eid: ["_running_tasks"] },
  DAYS_UNTIL_FULL: {
    keys: ["days_until_out_of_space"],
    uid: /_outOfSpaceInDays$/,
    eid: ["_days_until_out_of_space"],
  },
  FREE_PERCENT: {
    keys: ["free_space_percentage"],
    uid: /_free_percent$/,
    eid: ["_free_space_percentage"],
  },
};

/**
 * The one entity that answers "is this thing all right?", per model.
 *
 * The overview shows exactly one tile per device, named for the device. First match wins.
 * Status reads "Success" or "Failed", which says more than the Problem sensor's "OK"; a
 * repository's free space says more than either.
 */
const JOB_PRIMARY = [ROLE.STATUS, ROLE.PROBLEM, ROLE.LAST_RUN];
const PRIMARY_ROLES = {
  [MODEL.VBR_JOB]: JOB_PRIMARY,
  [MODEL.VBR_REPLICATION_JOB]: JOB_PRIMARY,
  [MODEL.VBR_COPY_JOB]: JOB_PRIMARY,
  [MODEL.M365_JOB]: JOB_PRIMARY,
  [MODEL.M365_COPY_JOB]: JOB_PRIMARY,
  [MODEL.VBR_REPOSITORY]: [ROLE.FREE_PERCENT, ROLE.STATUS, ROLE.PROBLEM, ROLE.FREE_SPACE],
  // Microsoft 365 repositories report no status, only space
  [MODEL.M365_REPOSITORY]: [ROLE.FREE_PERCENT, ROLE.FREE_SPACE, ROLE.CAPACITY],
  [MODEL.M365_OBJECT_STORAGE]: [ROLE.FREE_PERCENT, ROLE.FREE_SPACE, ROLE.CAPACITY],
  [MODEL.VBR_SERVER]: [ROLE.STATUS, ROLE.PROBLEM],
  [MODEL.M365_SERVER]: [ROLE.STATUS, ROLE.PROBLEM],
  [MODEL.M365_PROXY]: [ROLE.STATUS, ROLE.PROBLEM],
};

/** The server's entities promoted to badges, most important first. */
const BADGE_ROLES = [ROLE.CONNECTED, ROLE.ACTIVE_ALARMS, ROLE.LICENSE_DAYS];

/**
 * Diagnostic entities the server's sections are built around: without them the Veeam ONE
 * section would be a lone Connected tile and Licensing would not say what the license is.
 */
const ESSENTIAL_ROLES = [
  ROLE.VERSION,
  ROLE.LICENSE_TYPE,
  ROLE.LICENSE_PACKAGE,
  ROLE.LICENSE_INSTANCES,
];

/** Within a resource section, states read best in this order. */
const ENTITY_ORDER = [
  ROLE.STATUS,
  ROLE.PROBLEM,
  ROLE.FREE_PERCENT,
  ROLE.DAYS_UNTIL_FULL,
  ROLE.CAPACITY,
  ROLE.FREE_SPACE,
  ROLE.USED_SPACE,
  ROLE.LAST_RUN,
  ROLE.LAST_RUN_DURATION,
  ROLE.TRANSFERRED,
  ROLE.PROCESSED,
  ROLE.AVERAGE_DURATION,
  ROLE.RUNNING_TASKS,
];

/**
 * Figures that belong together, shown as one compact row rather than a tile each. `name` is
 * the short label inside the row, whose title already says the rest; a name the user gave the
 * entity still wins.
 */
const GLANCE_GROUPS = [
  {
    title: "Space",
    members: [
      [ROLE.CAPACITY, "Capacity"],
      [ROLE.FREE_SPACE, "Free"],
      [ROLE.USED_SPACE, "Used"],
    ],
  },
  {
    title: "Last run",
    members: [
      [ROLE.LAST_RUN_DURATION, "Duration"],
      [ROLE.TRANSFERRED, "Transferred"],
      [ROLE.PROCESSED, "Items"],
    ],
  },
];

/** The server's own entities, in the order its Veeam ONE and Licensing sections show them. */
const SERVER_ROLES = [ROLE.CONNECTED, ROLE.VERSION];
const LICENSE_ROLES = [
  ROLE.LICENSE_DAYS,
  ROLE.SUPPORT_DAYS,
  ROLE.LICENSE_EXPIRED,
  ROLE.SUPPORT_EXPIRED,
  ROLE.LICENSE_TYPE,
  ROLE.LICENSE_PACKAGE,
  ROLE.LICENSE_COMPANY,
  ROLE.LICENSE_INSTANCES,
  ROLE.LICENSE_SOCKETS,
];
const ALARM_ROLES = [ROLE.ACTIVE_ALARMS, ROLE.ERROR_ALARMS, ROLE.WARNING_ALARMS];
const UNIT_ROLES = [ROLE.UNIT_USED, ROLE.UNIT_LICENSED, ROLE.UNIT_PERCENT];
const COLLECTION_ROLES = [ROLE.COLLECTION_COUNT, ROLE.COLLECTION_HEALTH, ROLE.COLLECTION_PROBLEM];

/** The platforms Veeam ONE monitors, in the order the Inventory view shows them. */
const PLATFORMS = [
  ["Backup & Replication", "mdi:backup-restore"],
  ["Cloud Connect", "mdi:cloud-outline"],
  ["Microsoft 365", "mdi:microsoft"],
  ["VMware vSphere", "mdi:server-network"],
  ["Cloud Director", "mdi:cloud-cog-outline"],
  ["Hyper-V", "mdi:microsoft-windows"],
  ["Public cloud", "mdi:cloud"],
];
const OTHER_PLATFORM = ["Other", "mdi:shape-outline"];

/**
 * The integration's collection keys, which its count, health and problem sensors carry in their
 * unique IDs: platform and a label short enough for a row already headed by the platform.
 * Listed in the integration's own order.
 */
const COLLECTIONS = {
  jobs: ["Backup & Replication", "Backup jobs"],
  replication_jobs: ["Backup & Replication", "Replication jobs"],
  copy_jobs: ["Backup & Replication", "Backup copy jobs"],
  repositories: ["Backup & Replication", "Repositories"],
  servers: ["Backup & Replication", "Backup servers"],
  cloud_connect_tenants: ["Cloud Connect", "Tenants"],
  cloud_connect_gateways: ["Cloud Connect", "Gateways"],
  cloud_connect_gateway_pools: ["Cloud Connect", "Gateway pools"],
  m365_organizations: ["Microsoft 365", "Organizations"],
  m365_servers: ["Microsoft 365", "Servers"],
  m365_proxies: ["Microsoft 365", "Backup proxies"],
  m365_repositories: ["Microsoft 365", "Repositories"],
  m365_object_storage: ["Microsoft 365", "Object storage"],
  m365_backup_jobs: ["Microsoft 365", "Backup jobs"],
  m365_copy_jobs: ["Microsoft 365", "Copy jobs"],
  m365_users: ["Microsoft 365", "Users"],
  m365_groups: ["Microsoft 365", "Groups"],
  m365_sites: ["Microsoft 365", "Sites"],
  m365_teams: ["Microsoft 365", "Teams"],
  m365_protected_users: ["Microsoft 365", "Protected users"],
  m365_protected_groups: ["Microsoft 365", "Protected groups"],
  m365_protected_sites: ["Microsoft 365", "Protected sites"],
  m365_protected_teams: ["Microsoft 365", "Protected teams"],
  vsphere_vcenters: ["VMware vSphere", "vCenters"],
  vsphere_hosts: ["VMware vSphere", "Hosts"],
  vsphere_clusters: ["VMware vSphere", "Clusters"],
  vsphere_datastores: ["VMware vSphere", "Datastores"],
  vsphere_datastore_clusters: ["VMware vSphere", "Datastore clusters"],
  vsphere_resource_pools: ["VMware vSphere", "Resource pools"],
  vsphere_vms: ["VMware vSphere", "VMs"],
  vsphere_vapps: ["VMware vSphere", "vApps"],
  vcd_servers: ["Cloud Director", "Servers"],
  vcd_organizations: ["Cloud Director", "Organizations"],
  vcd_org_vdcs: ["Cloud Director", "Organization VDCs"],
  vcd_provider_vdcs: ["Cloud Director", "Provider VDCs"],
  vcd_datastores: ["Cloud Director", "Datastores"],
  vcd_vapps: ["Cloud Director", "vApps"],
  hyperv_hosts: ["Hyper-V", "Hosts"],
  hyperv_clusters: ["Hyper-V", "Clusters"],
  hyperv_vms: ["Hyper-V", "VMs"],
  hyperv_file_servers: ["Hyper-V", "File servers"],
  hyperv_file_shares: ["Hyper-V", "File shares"],
  hyperv_physical_disks: ["Hyper-V", "Physical disks"],
  hyperv_sc_vmm_servers: ["Hyper-V", "SCVMM servers"],
  public_cloud_vms: ["Public cloud", "VMs"],
  public_cloud_databases: ["Public cloud", "Databases"],
  public_cloud_file_shares: ["Public cloud", "File shares"],
  public_cloud_vm_backups: ["Public cloud", "Protected VMs"],
  public_cloud_db_backups: ["Public cloud", "Protected databases"],
  public_cloud_file_backups: ["Public cloud", "Protected file shares"],
  public_cloud_network_backups: ["Public cloud", "Protected networks"],
};
const COLLECTION_ORDER = Object.keys(COLLECTIONS);

function options(config) {
  return { ...DEFAULTS, ...(config || {}) };
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function deviceName(device) {
  return device.name_by_user || device.name || "Unnamed";
}

/**
 * The device name as a title: "Veeam ONE Nightly VMs" reads "Nightly VMs" under Backup jobs.
 *
 * The server device is called just "Veeam ONE" and keeps it. A name the user gave a device is
 * theirs and is shown as it is.
 */
function displayName(device) {
  if (device.name_by_user) return device.name_by_user;
  const name = device.name || "";
  const rest = name.replace(DEVICE_PREFIX, "").trim();
  return rest || name || "Unnamed";
}

function byName(a, b) {
  return displayName(a).localeCompare(displayName(b), undefined, { numeric: true });
}

function domainOf(entity) {
  return (entity.entity_id || "").split(".")[0];
}

/** Entity ID without its domain and without the "_2" Home Assistant adds on collision. */
function objectId(entity) {
  return (entity.entity_id || "").split(".").slice(1).join(".").replace(/_\d+$/, "");
}

/** The unique ID with the "<config entry ID>_" the integration puts in front taken off. */
function localId(entity) {
  const uid = entity.unique_id || "";
  const prefix = entity.config_entry_id ? `${entity.config_entry_id}_` : "";
  return prefix && uid.startsWith(prefix) ? uid.slice(prefix.length) : uid;
}

/** Whether the entity plays this role. See ROLE for the order identifiers are trusted in. */
function hasRole(entity, role) {
  if (role.domain && domainOf(entity) !== role.domain) return false;
  if (entity.translation_key) return role.keys.includes(entity.translation_key);
  if (entity.unique_id) return role.uid.test(localId(entity));
  const id = objectId(entity);
  return role.eid.some((suffix) => id.endsWith(suffix));
}

function findByRoles(entities, roles) {
  for (const role of roles || []) {
    const found = entities.find((entity) => hasRole(entity, role));
    if (found) return found;
  }
  return null;
}

function isEssential(entity, model) {
  return model === MODEL.SERVER && ESSENTIAL_ROLES.some((role) => hasRole(entity, role));
}

/**
 * The entity's own short name — "Status", "Free space", "Active alarms".
 *
 * Inside a section already titled with the device name, the full friendly name repeats it on
 * every tile. The registry keeps the user's override and the original separately, so a rename
 * is still respected.
 */
function entityName(entity, device) {
  const own = entity.name || entity.original_name;
  if (own) return own;

  // No registry name: derive one from the object id, minus the device slug it starts with
  const id = objectId(entity);
  const slugs = [deviceName(device), device.name, "veeam_one"]
    .map(slugify)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const slug = slugs.find((candidate) => id.startsWith(`${candidate}_`));
  const trimmed = slug ? id.slice(slug.length + 1) : id;
  const words = trimmed.split("_").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function orderRank(entity) {
  const index = ENTITY_ORDER.findIndex((role) => hasRole(entity, role));
  return index === -1 ? ENTITY_ORDER.length : index;
}

/**
 * Entities belonging to this integration, keyed by device.
 *
 * Filtering on the registry rather than on entity_id patterns means renamed entities are
 * still found, and entities the user disabled or hid stay out of the way.
 */
function entitiesByDevice(entities, devices, opts) {
  const byDevice = new Map();
  const modelOf = new Map(devices.map((device) => [device.id, device.model]));

  for (const entity of entities) {
    if (entity.platform !== INTEGRATION) continue;
    if (entity.disabled_by) continue;
    if (entity.hidden_by && !opts.include_hidden) continue;
    if (!entity.device_id) continue;
    if (
      entity.entity_category === "diagnostic" &&
      !opts.include_diagnostics &&
      !isEssential(entity, modelOf.get(entity.device_id))
    ) {
      continue;
    }

    const list = byDevice.get(entity.device_id) || [];
    list.push(entity);
    byDevice.set(entity.device_id, list);
  }

  // States first, in reading order, then diagnostics
  for (const list of byDevice.values()) {
    list.sort((a, b) => {
      const diagnostic = (entity) => (entity.entity_category === "diagnostic" ? 1 : 0);
      const byCategory = diagnostic(a) - diagnostic(b);
      if (byCategory !== 0) return byCategory;

      const byOrder = orderRank(a) - orderRank(b);
      if (byOrder !== 0) return byOrder;
      return (a.entity_id || "").localeCompare(b.entity_id || "");
    });
  }

  return byDevice;
}

/** Devices of this integration that still have at least one usable entity. */
function devicesWithEntities(devices, byDevice) {
  return devices.filter((device) => !device.disabled_by && byDevice.has(device.id)).sort(byName);
}

function groupByModel(devices) {
  const groups = new Map();
  for (const device of devices) {
    const model = device.model || "Other";
    const list = groups.get(model) || [];
    list.push(device);
    groups.set(model, list);
  }
  return groups;
}

function entryOf(device) {
  return (device.config_entries || [])[0];
}

/**
 * Map config entry id -> a label for it.
 *
 * Every server device is called "Veeam ONE", so with several servers the device names cannot
 * tell them apart. The config entries can: the integration titles them "Veeam ONE (<host>)".
 * A name the user gave the server device wins over the host.
 */
function entryLabels(devices, entries) {
  const labels = new Map();
  for (const entry of entries || []) {
    const title = entry.title || "";
    const host = title.match(/^Veeam ONE\s*\((.+)\)$/i);
    const label = host ? host[1] : title;
    if (entry.entry_id && label) labels.set(entry.entry_id, label);
  }
  for (const device of devices) {
    if (device.model !== MODEL.SERVER || !device.name_by_user) continue;
    for (const entryId of device.config_entries || []) labels.set(entryId, device.name_by_user);
  }
  return labels;
}

/** " — host" with several servers, so two identically named jobs can be told apart. */
function withLabel(title, device, context, separator = " — ") {
  if (!context.multiServer) return title;
  const label = context.labels.get(entryOf(device));
  if (!label || title === label) return title;
  return `${title}${separator}${label}`;
}

// ---------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------

function tile(entityId, extra = {}) {
  return { type: "tile", entity: entityId, ...extra };
}

function heading(text, icon, extra = {}) {
  return {
    type: "heading",
    heading: text,
    heading_style: "title",
    ...(icon ? { icon } : {}),
    ...extra,
  };
}

function section(cards, extra = {}) {
  return { type: "grid", cards, ...extra };
}

function titledSection(title, icon, cards, extra = {}) {
  return section([heading(title, icon), ...cards], extra);
}

function markdown(content, extra = {}) {
  return { type: "markdown", content, ...extra };
}

/** A compact row of figures, for values that read as one line rather than a tile each. */
function glance(title, entities) {
  return { type: "glance", title, entities, grid_options: { columns: "full" } };
}

/** Free space reads far better as a gauge than as "24.6%" on a tile. Low is bad. */
function freeSpaceGauge(entityId, name, warnAt) {
  return {
    type: "gauge",
    entity: entityId,
    name,
    min: 0,
    max: 100,
    needle: true,
    severity: { red: 0, yellow: Math.max(0, warnAt - 10), green: warnAt },
  };
}

/** License use as a gauge. High is bad. */
function usageGauge(entityId, name, warnAt) {
  return {
    type: "gauge",
    entity: entityId,
    name,
    min: 0,
    max: 100,
    needle: true,
    severity: { green: 0, yellow: warnAt, red: Math.min(100, warnAt + 10) },
  };
}

// ---------------------------------------------------------------------------------------------
// Live summary
//
// Generated once per page load, so nothing here may depend on current states — a stale
// snapshot baked into card order or colour is worse than none. The counting is left to a
// template, which Home Assistant re-renders as states change.
// ---------------------------------------------------------------------------------------------

function jinjaList(entityIds) {
  return `[${entityIds.map((id) => `'${id}'`).join(", ")}]`;
}

/** Entity ID -> display name, for templates that name what they count. */
function jinjaNames(pairs) {
  return `{${pairs.map(([id, name]) => `'${id}': ${JSON.stringify(name)}`).join(", ")}}`;
}

/** "a, b, c and 2 more" from the ids in a Jinja variable, via a names dict. */
function jinjaNameList(variable, names = "names", limit = 5) {
  return (
    `{% for e in ${variable}[:${limit}] %}{{ ${names}[e] }}` +
    "{{ ', ' if not loop.last else '' }}{% endfor %}" +
    `{% if ${variable} | count > ${limit} %} and {{ ${variable} | count - ${limit} }} more` +
    "{% endif %}"
  );
}

/** A poll that fails turns Connected off and every other entity unavailable. */
function connectionSummary(connectedIds) {
  return [
    `{% set connected = ${jinjaList(connectedIds)} %}`,
    "{% set down = connected | select('is_state', 'off') | list | count %}",
    "{% if down %}" +
      '<ha-alert alert-type="error" title="Veeam ONE is not answering">' +
      "The last poll{% if connected | count > 1 %} of {{ down }} of {{ connected | count }} " +
      "servers{% endif %} failed, so the values here are out of date.</ha-alert>" +
      "{% endif %}",
  ].join("\n");
}

function alarmSummary(activeIds, errorIds, warningIds) {
  const sum = (ids) => `${jinjaList(ids)} | map('states') | map('int', 0) | sum`;
  return [
    `{% set active_ids = ${jinjaList(activeIds)} %}`,
    "{% set lost = active_ids | map('states') " +
      "| select('in', ['unavailable', 'unknown']) | list | count %}",
    `{% set active = ${sum(activeIds)} %}`,
    `{% set errors = ${sum(errorIds)} %}`,
    `{% set warnings = ${sum(warningIds)} %}`,
    "## {% if errors %}{{ errors }} error alarm{{ 's' if errors > 1 else '' }}" +
      "{% elif warnings %}{{ warnings }} warning alarm{{ 's' if warnings > 1 else '' }}" +
      "{% elif active %}{{ active }} active alarm{{ 's' if active > 1 else '' }}" +
      "{% elif lost %}Alarms unavailable" +
      "{% else %}No active alarms{% endif %}",
    "{{ errors }} error{{ '' if errors == 1 else 's' }} &nbsp;·&nbsp; " +
      "{{ warnings }} warning{{ '' if warnings == 1 else 's' }}" +
      "{% if lost and active_ids | count > 1 %} &nbsp;·&nbsp; {{ lost }} of " +
      "{{ active_ids | count }} servers not reporting{% endif %}" +
      "{% if active %} &nbsp;·&nbsp; see the Alarms view{% endif %}",
  ].join("\n");
}

/**
 * Jobs, repositories, servers and proxies whose status Veeam ONE reports as a problem.
 *
 * Counted from the same Problem sensors the device sections show. A resource whose status is
 * Unknown has a Problem sensor that is unknown too, and is counted neither way.
 */
function problemSummary(pairs) {
  return [
    `{% set problems = ${jinjaList(pairs.map(([id]) => id))} %}`,
    `{% set names = ${jinjaNames(pairs)} %}`,
    "{% set bad = problems | select('is_state', 'on') | list %}",
    "{% set ok = problems | select('is_state', 'off') | list | count %}",
    "{% set lost = problems | select('is_state', 'unavailable') | list | count %}",
    "{% if bad %}**{{ bad | count }} of {{ problems | count }}** monitored resource" +
      "{{ '' if problems | count == 1 else 's' }} report a problem: " +
      jinjaNameList("bad") +
      ".{% elif ok %}No problems across {{ ok }} monitored resource{{ '' if ok == 1 else 's' }}." +
      "{% endif %}" +
      "{% if lost %} **{{ lost }}** unavailable.{% endif %}",
  ].join("\n");
}

/** Repositories low on free space, or about to run out. */
function repositorySummary(freePairs, daysPairs, warnAt, warnDays) {
  const lines = [`{% set names = ${jinjaNames([...freePairs, ...daysPairs])} %}`];
  if (freePairs.length) {
    lines.push(
      `{% set free = ${jinjaList(freePairs.map(([id]) => id))} %}`,
      "{% set low = namespace(ids=[]) %}",
      "{% for r in free %}{% set v = states(r) | float(-1) %}" +
        `{% if v >= 0 and v < ${warnAt} %}{% set low.ids = low.ids + [r] %}{% endif %}` +
        "{% endfor %}",
      "{% set low = low.ids %}",
      "{% if low %}**{{ low | count }} of {{ free | count }}** repositor" +
        "{{ 'y' if free | count == 1 else 'ies' }} " +
        `below ${warnAt}% free: ` +
        jinjaNameList("low") +
        ".{% endif %}",
    );
  }
  if (daysPairs.length) {
    lines.push(
      `{% set days = ${jinjaList(daysPairs.map(([id]) => id))} %}`,
      "{% set soon = namespace(ids=[]) %}",
      "{% for r in days %}{% set v = states(r) | float(-1) %}" +
        `{% if v >= 0 and v <= ${warnDays} %}{% set soon.ids = soon.ids + [r] %}{% endif %}` +
        "{% endfor %}",
      "{% set soon = soon.ids %}",
      "{% if soon %}" +
        '<ha-alert alert-type="warning" title="Running out of space">' +
        "{% for r in soon[:5] %}{{ names[r] }} in {{ states(r) | int }} " +
        "day{{ '' if states(r) | int == 1 else 's' }}{{ ', ' if not loop.last else '' }}" +
        "{% endfor %}{% if soon | count > 5 %} and {{ soon | count - 5 }} more{% endif %}." +
        "</ha-alert>{% endif %}",
    );
  }
  return lines.join("\n");
}

/**
 * The license, raised only when it needs attention. Once it expires Veeam ONE stops collecting,
 * so every other number on the dashboard goes stale without saying so.
 */
function licenseSummary(expiredIds, daysIds, supportIds, warnDays) {
  const lines = [
    `{% set expired = ${jinjaList(expiredIds)} | select('is_state', 'on') | list | count %}`,
    `{% set support = ${jinjaList(supportIds)} | select('is_state', 'on') | list | count %}`,
    daysIds.length
      ? `{% set days = ${jinjaList(daysIds)} | map('states') | map('int', 99999) | min %}`
      : "{% set days = 99999 %}",
    "{% if expired %}" +
      '<ha-alert alert-type="error" title="Veeam ONE license expired' +
      '{% if expired > 1 %} on {{ expired }} servers{% endif %}">' +
      "Veeam ONE stops collecting data once its license expires, so the values here are out " +
      "of date. Install a renewed license in the Veeam ONE Client.</ha-alert>" +
      `{% elif days < ${warnDays} %}` +
      '<ha-alert alert-type="warning" title="Veeam ONE license expires in {{ days }} ' +
      "day{{ '' if days == 1 else 's' }}\">" +
      "Install a renewed license in the Veeam ONE Client before it runs out.</ha-alert>" +
      "{% endif %}",
    "{% if support and not expired %}" +
      '<ha-alert alert-type="warning" title="Veeam ONE support has expired">' +
      "The license is still valid, but support and updates have ended.</ha-alert>" +
      "{% endif %}",
  ];
  return lines.join("\n");
}

function summarySection(context, opts, columns) {
  const { groups, byDevice } = context;
  const servers = groups.get(MODEL.SERVER) || [];
  const serverIds = (roles) =>
    servers
      .map((device) => findByRoles(byDevice.get(device.id) || [], roles))
      .filter(Boolean)
      .map((entity) => entity.entity_id);

  // The same entities the sections show, so the headline can never disagree with them
  const pairs = (models, roles) =>
    models.flatMap((model) =>
      (groups.get(model) || []).flatMap((device) => {
        const entity = findByRoles(byDevice.get(device.id) || [], roles);
        return entity
          ? [[entity.entity_id, withLabel(displayName(device), device, context, " on ")]]
          : [];
      }),
    );

  const connected = serverIds([ROLE.CONNECTED]);
  const active = serverIds([ROLE.ACTIVE_ALARMS]);
  const problems = pairs(MODEL_ORDER, [ROLE.PROBLEM]);
  const free = pairs(REPOSITORY_MODELS, [ROLE.FREE_PERCENT]);
  const days = pairs(REPOSITORY_MODELS, [ROLE.DAYS_UNTIL_FULL]);
  const expired = serverIds([ROLE.LICENSE_EXPIRED]);
  const licenseDays = serverIds([ROLE.LICENSE_DAYS]);
  const support = serverIds([ROLE.SUPPORT_EXPIRED]);

  const parts = [];
  if (connected.length) parts.push(connectionSummary(connected));
  if (active.length) {
    parts.push(
      alarmSummary(active, serverIds([ROLE.ERROR_ALARMS]), serverIds([ROLE.WARNING_ALARMS])),
    );
  }
  if (problems.length) parts.push(problemSummary(problems));
  if (free.length || days.length) {
    parts.push(repositorySummary(free, days, opts.free_space_warn_at, opts.out_of_space_warn_days));
  }
  if (expired.length || licenseDays.length || support.length) {
    parts.push(licenseSummary(expired, licenseDays, support, opts.license_warn_days));
  }
  // Connection alone is not a headline: it says nothing at all while things are fine
  if (parts.length === (connected.length ? 1 : 0)) return null;

  return section([markdown(parts.join("\n\n"))], { column_span: columns });
}

// ---------------------------------------------------------------------------------------------
// Resource sections
// ---------------------------------------------------------------------------------------------

/** One section per resource device, listing its entities by their own short names. */
function deviceSections(devices, context, opts) {
  return devices.map((device) => {
    const entities = context.byDevice.get(device.id) || [];
    const title = withLabel(displayName(device), device, context);
    return titledSection(title, MODEL_ICON.get(device.model), deviceCards(entities, device, opts));
  });
}

/**
 * A tile per entity, in the order entitiesByDevice sorted them — except that free space is a
 * gauge at the top, and the members of a glance group share one row, placed where the first of
 * them would have been.
 */
function deviceCards(entities, device, opts) {
  const gauges = [];
  const cards = [];
  const grouped = new Set();

  for (const entity of entities) {
    if (grouped.has(entity)) continue;
    const name = entityName(entity, device);

    if (hasRole(entity, ROLE.FREE_PERCENT)) {
      // "Free space percentage" beside a gauge marked 0-100 says nothing the gauge does not
      gauges.push(
        freeSpaceGauge(entity.entity_id, entity.name || "Free space", opts.free_space_warn_at),
      );
      continue;
    }

    const group = GLANCE_GROUPS.find((candidate) =>
      candidate.members.some(([role]) => hasRole(entity, role)),
    );
    if (!group) {
      cards.push(tile(entity.entity_id, { name }));
      continue;
    }

    const row = [];
    for (const [role, short] of group.members) {
      const member = entities.find(
        (candidate) => !grouped.has(candidate) && hasRole(candidate, role),
      );
      if (!member) continue;
      grouped.add(member);
      row.push({ entity: member.entity_id, name: member.name || short });
    }
    cards.push(glance(group.title, row));
  }

  // A gauge wedged between two tiles reads as a mistake; it belongs at the top of the section
  return [...gauges, ...cards];
}

// ---------------------------------------------------------------------------------------------
// The Veeam ONE server's sections
//
// The integration puts the server's own state, its alarms, its license and a count of every
// collection it monitors on one device. One section of fifty tiles would be unreadable, so
// each concern gets its own.
// ---------------------------------------------------------------------------------------------

function serverDevices(context) {
  return [...(context.groups.get(MODEL.SERVER) || [])].sort((a, b) =>
    withLabel(displayName(a), a, context).localeCompare(withLabel(displayName(b), b, context)),
  );
}

function takeRoles(entities, roles, taken) {
  const found = [];
  for (const role of roles) {
    for (const entity of entities) {
      if (taken.has(entity) || !hasRole(entity, role)) continue;
      taken.add(entity);
      found.push(entity);
    }
  }
  return found;
}

/** Connected and Version, and anything of the server's no other section claims. */
function serverSection(device, context) {
  const entities = context.byDevice.get(device.id) || [];
  const taken = new Set();
  const own = takeRoles(entities, SERVER_ROLES, taken);
  takeRoles(
    entities,
    [...LICENSE_ROLES, ...UNIT_ROLES, ...ALARM_ROLES, ...COLLECTION_ROLES],
    taken,
  );
  const rest = entities.filter((entity) => !taken.has(entity));
  if (!own.length && !rest.length) return null;

  const cards = [...own, ...rest].map((entity) =>
    tile(entity.entity_id, { name: entityName(entity, device) }),
  );
  const connected = own.find((entity) => hasRole(entity, ROLE.CONNECTED));
  if (connected) {
    cards.push(
      markdown(
        "The last poll of the Veeam ONE REST API failed. Every other entity is unavailable " +
          "until it answers again.",
        { visibility: [{ condition: "state", entity: connected.entity_id, state: "off" }] },
      ),
    );
  }
  return titledSection(withLabel(displayName(device), device, context), SERVER_ICON, cards);
}

/** The license unit ("instances") a per-unit sensor is for, from its unique ID or name. */
function licenseUnit(entity) {
  const match = localId(entity).match(/^license_(.+)_(used|licensed|percentage)$/);
  if (match) return match[1];
  const name = (entity.original_name || "").match(/^License (.+?) (used|licensed)/i);
  return name ? slugify(name[1]) : objectId(entity);
}

function unitLabel(unit) {
  const words = unit.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Expiry, what the license is, and how much of each unit is used. */
function licenseSection(device, context, opts) {
  const entities = context.byDevice.get(device.id) || [];
  const taken = new Set();
  const fields = takeRoles(entities, LICENSE_ROLES, taken);
  const units = takeRoles(entities, UNIT_ROLES, taken);
  if (!fields.length && !units.length) return null;

  const cards = [];
  const expired = fields.find((entity) => hasRole(entity, ROLE.LICENSE_EXPIRED));
  const days = fields.find((entity) => hasRole(entity, ROLE.LICENSE_DAYS));
  if (expired) {
    cards.push(
      markdown(
        '<ha-alert alert-type="error" title="License expired">' +
          "Veeam ONE stops collecting data once its license expires. Install a renewed license " +
          "in the Veeam ONE Client.</ha-alert>",
        { visibility: [{ condition: "state", entity: expired.entity_id, state: "on" }] },
      ),
    );
  }
  if (days) {
    const visibility = [
      {
        condition: "numeric_state",
        entity: days.entity_id,
        below: opts.license_warn_days,
        above: -1,
      },
    ];
    cards.push(
      markdown(
        `{% set days = states('${days.entity_id}') | int(0) %}` +
          '<ha-alert alert-type="warning" ' +
          "title=\"License expires in {{ days }} day{{ '' if days == 1 else 's' }}\">" +
          "Install a renewed license in the Veeam ONE Client before it runs out.</ha-alert>",
        { visibility },
      ),
    );
  }

  cards.push(
    ...fields.map((entity) => tile(entity.entity_id, { name: entityName(entity, device) })),
  );

  // Per unit: the percentage as a gauge, then used and licensed as one row
  const unitNames = [...new Set(units.map(licenseUnit))];
  for (const unit of unitNames) {
    const mine = units.filter((entity) => licenseUnit(entity) === unit);
    const label = unitLabel(unit);
    const percent = mine.find((entity) => hasRole(entity, ROLE.UNIT_PERCENT));
    if (percent) {
      cards.push(
        usageGauge(percent.entity_id, percent.name || `${label} used`, opts.license_warn_at),
      );
    }
    const row = [
      [ROLE.UNIT_USED, "Used"],
      [ROLE.UNIT_LICENSED, "Licensed"],
    ].flatMap(([role, short]) => {
      const entity = mine.find((candidate) => hasRole(candidate, role));
      return entity ? [{ entity: entity.entity_id, name: entity.name || short }] : [];
    });
    if (row.length) cards.push(glance(label, row));
  }

  return titledSection(withLabel("Licensing", device, context), "mdi:certificate", cards);
}

/**
 * The server's triggered alarms: the counts, then the list from Active alarms' `alarms`
 * attribute, newest first. The integration caps the list at 50, so the table says when there
 * are more.
 */
function alarmSection(device, context) {
  const entities = context.byDevice.get(device.id) || [];
  const counts = takeRoles(entities, ALARM_ROLES, new Set());
  if (!counts.length) return null;

  const cards = counts.map((entity) =>
    tile(entity.entity_id, { name: entityName(entity, device) }),
  );
  const active = counts.find((entity) => hasRole(entity, ROLE.ACTIVE_ALARMS));
  if (active)
    cards.push(
      markdown(alarmTable(active.entity_id, context.multiServer ? entryOf(device) : null)),
    );

  return titledSection(withLabel("Alarms", device, context), "mdi:alarm-light", cards, {
    column_span: 2,
  });
}

function alarmTable(entityId, entryId) {
  const escape = (field) => `{{ (a.${field} or '') | string | replace('|', '/') }}`;
  const entryNote = entryId ? `, and <code>config_entry_id: ${entryId}</code>` : "";
  return [
    `{% set alarms = state_attr('${entityId}', 'alarms') or [] %}`,
    `{% set total = states('${entityId}') | int(0) %}`,
    "{% if alarms %}",
    "| Status | Alarm | Object | Triggered | ID |",
    "| --- | --- | --- | --- | ---: |",
    "{% for a in alarms %}" +
      "| {{ '**Error**' if a.status == 'Error' else a.status }} " +
      `| ${escape("name")}{% if (a.repeat_count or 0) > 1 %} ×{{ a.repeat_count }}{% endif %} ` +
      `| ${escape("object")} ` +
      "| {% set t = as_timestamp(a.triggered, none) %}" +
      "{{ t | timestamp_custom('%Y-%m-%d %H:%M') if t else '' }} " +
      "| {{ a.id }} |\n" +
      "{% endfor %}",
    "{% if total > alarms | count %}Showing the newest {{ alarms | count }} of {{ total }}." +
      "{% endif %}",
    "",
    "Resolve alarms with the <code>veeam_one.resolve_alarm</code> action, passing the IDs " +
      `above as <code>alarm_ids</code>${entryNote}.`,
    "{% elif states('" +
      entityId +
      "') in ['unavailable', 'unknown'] %}Alarms are unavailable." +
      "{% else %}No active alarms.{% endif %}",
  ].join("\n");
}

/** The collection key a count, health or problem sensor is for. */
function collectionKey(entity) {
  const key = localId(entity).replace(/_(count|health|problem)$/, "");
  return key || objectId(entity);
}

/** The collection's label from the table above, else the entity's own name. */
function collectionLabel(entity, role) {
  const known = COLLECTIONS[collectionKey(entity)];
  if (known) return known[1];
  const own = entity.original_name || entity.name || collectionKey(entity);
  return role === ROLE.COLLECTION_COUNT ? own : own.replace(/\s+(health|problem)$/i, "");
}

/**
 * What Veeam ONE counts on each platform, and for collections with a status, whether any of
 * their resources report a problem and how much of the collection is healthy.
 */
function inventorySections(device, context) {
  const entities = context.byDevice.get(device.id) || [];
  const byPlatform = new Map();

  for (const role of COLLECTION_ROLES) {
    for (const entity of entities) {
      if (!hasRole(entity, role)) continue;
      const known = COLLECTIONS[collectionKey(entity)];
      const platform = known ? known[0] : OTHER_PLATFORM[0];
      const bucket = byPlatform.get(platform) || new Map(COLLECTION_ROLES.map((r) => [r, []]));
      bucket.get(role).push(entity);
      byPlatform.set(platform, bucket);
    }
  }

  const rank = (entity) => {
    const index = COLLECTION_ORDER.indexOf(collectionKey(entity));
    return index === -1 ? COLLECTION_ORDER.length : index;
  };
  const sorted = (list) =>
    [...list].sort((a, b) => rank(a) - rank(b) || (a.entity_id || "").localeCompare(b.entity_id));

  const sections = [];
  for (const [platform, icon] of [...PLATFORMS, OTHER_PLATFORM]) {
    const bucket = byPlatform.get(platform);
    if (!bucket) continue;

    const name = (entity, role) => entity.name || collectionLabel(entity, role);
    const cards = [];
    const counts = sorted(bucket.get(ROLE.COLLECTION_COUNT));
    if (counts.length) {
      cards.push(
        glance(
          "Monitored",
          counts.map((entity) => ({
            entity: entity.entity_id,
            name: name(entity, ROLE.COLLECTION_COUNT),
          })),
        ),
      );
    }
    for (const entity of sorted(bucket.get(ROLE.COLLECTION_PROBLEM))) {
      cards.push(tile(entity.entity_id, { name: name(entity, ROLE.COLLECTION_PROBLEM) }));
    }
    const health = sorted(bucket.get(ROLE.COLLECTION_HEALTH));
    if (health.length) {
      cards.push(
        glance(
          "Health",
          health.map((entity) => ({
            entity: entity.entity_id,
            name: name(entity, ROLE.COLLECTION_HEALTH),
          })),
        ),
      );
    }
    sections.push(titledSection(withLabel(platform, device, context), icon, cards));
  }
  return sections;
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

/** "Nightly VMs", or "Nightly VMs (host)" with several servers. */
function overviewName(device, context) {
  const name = displayName(device);
  const label = context.multiServer ? context.labels.get(entryOf(device)) : null;
  return label && label !== name ? `${name} (${label})` : name;
}

/** One tile per resource device, named for the device. */
function overviewSections(context, opts, columns) {
  const sections = [];

  const summary = opts.summary ? summarySection(context, opts, columns) : null;
  if (summary) sections.push(summary);

  // With badges on, the server's state lives along the top; with badges off it needs a section
  // here or it is lost
  if (!opts.badges) {
    for (const device of serverDevices(context)) {
      const entities = context.byDevice.get(device.id) || [];
      const cards = BADGE_ROLES.map((role) => findByRoles(entities, [role]))
        .filter(Boolean)
        .map((entity) => tile(entity.entity_id, { name: entityName(entity, device) }));
      if (cards.length) {
        sections.push(
          titledSection(withLabel(displayName(device), device, context), SERVER_ICON, cards),
        );
      }
    }
  }

  for (const model of MODEL_ORDER) {
    const devices = context.groups.get(model);
    if (!devices || !devices.length) continue;

    const cards = [];
    for (const device of devices) {
      const entities = context.byDevice.get(device.id) || [];
      const primary = findByRoles(entities, PRIMARY_ROLES[model]) || entities[0];
      if (!primary) continue;
      cards.push(tile(primary.entity_id, { name: overviewName(device, context) }));
    }

    if (cards.length) {
      sections.push(titledSection(MODEL_TITLE.get(model) || model, MODEL_ICON.get(model), cards));
    }
  }

  return sections;
}

/** Connected, Active alarms and License days remaining, along the top of the overview. */
function overviewBadges(context) {
  const badges = [];
  for (const device of serverDevices(context)) {
    const entities = context.byDevice.get(device.id) || [];
    for (const role of BADGE_ROLES) {
      const entity = findByRoles(entities, [role]);
      if (!entity) continue;

      const label = context.multiServer ? context.labels.get(entryOf(device)) : null;
      const name = entityName(entity, device);
      badges.push({
        type: "entity",
        entity: entity.entity_id,
        name: label ? `${name} (${label})` : name,
        show_state: true,
        show_name: true,
      });
    }
  }
  return badges;
}

function emptyView(opts) {
  return {
    title: opts.title || "Veeam ONE",
    icon: opts.icon || SERVER_ICON,
    cards: [
      markdown(
        "### No Veeam ONE entities found\n\n" +
          "This dashboard builds itself from the " +
          "[Veeam ONE integration](https://github.com/Cenvora/ha-veeam-one). " +
          "Add the integration under **Settings → Devices & Services**, then reload this page.\n\n" +
          "If the integration is already set up, its entities may all be disabled or hidden.",
      ),
    ],
  };
}

/** Everything the layout needs, derived once from the registries. */
function analyse(registries, opts) {
  const byDevice = entitiesByDevice(registries.entities || [], registries.devices || [], opts);
  const devices = devicesWithEntities(registries.devices || [], byDevice);

  return {
    byDevice,
    devices,
    groups: groupByModel(devices),
    labels: entryLabels(devices, registries.entries),
    multiServer: new Set(devices.map(entryOf).filter(Boolean)).size > 1,
  };
}

/** Build the sections for one group. Exported for the view strategy and for tests. */
export function buildSections(group, registries, config) {
  const opts = options(config);
  const context = analyse(registries, opts);

  if (!context.devices.length) return null;

  const sectionsFor = (models) =>
    deviceSections(
      models.flatMap((model) => context.groups.get(model) || []),
      context,
      opts,
    );
  const perServer = (build) => serverDevices(context).flatMap((device) => build(device) || []);

  switch (group) {
    case "alarms":
      return perServer((device) => alarmSection(device, context));
    case "jobs":
      return sectionsFor(JOB_MODELS);
    case "repositories":
      return sectionsFor(REPOSITORY_MODELS);
    case "infrastructure":
      return [
        ...sectionsFor(INFRASTRUCTURE_MODELS),
        ...perServer((device) =>
          [serverSection(device, context), licenseSection(device, context, opts)].filter(Boolean),
        ),
      ];
    case "inventory":
      return perServer((device) => inventorySections(device, context));
    case "overview":
    default:
      return overviewSections(context, opts, opts.columns);
  }
}

/**
 * View settings the strategy config can carry.
 *
 * Everything the view editor would normally set has to be settable here instead: Home Assistant
 * applies the generated config over the view's own keys, and renaming or restyling a strategy
 * view in the visual editor replaces the strategy with static cards.
 */
const VIEW_SETTINGS = [
  "title",
  "path",
  "icon",
  "theme",
  "background",
  "subview",
  "visible",
  "max_columns",
  "dense_section_placement",
  "header",
  "top_margin",
];

/**
 * Whatever the config asks to put on the view.
 *
 * `view:` is a verbatim escape hatch, so a key Home Assistant adds later needs no change here.
 * `type`, `sections`, `badges` and `cards` are ours to decide and are not accepted.
 */
function viewSettings(opts) {
  const settings = {};
  for (const key of VIEW_SETTINGS) {
    if (opts[key] !== undefined) settings[key] = opts[key];
  }

  const verbatim = { ...(opts.view || {}) };
  for (const key of ["type", "sections", "badges", "cards", "strategy"]) delete verbatim[key];

  return { ...settings, ...verbatim };
}

/**
 * Build one view. Exported for tests.
 *
 * Titles come from the strategy config rather than the view, because Home Assistant applies a
 * strategy's generated config over the view's own keys.
 */
export function buildView(group, registries, config) {
  const opts = options(config);
  const sections = buildSections(group, registries, config);
  if (!sections || !sections.length) return null;

  const defaults = GROUP_VIEW[group] || GROUP_VIEW.overview;
  const view = {
    title: defaults.title,
    path: defaults.path,
    icon: defaults.icon,
    max_columns: opts.columns,
    dense_section_placement: true,
    ...viewSettings(opts),
    type: "sections",
    sections,
  };

  if (group === "overview" && opts.badges) {
    const badges = overviewBadges(analyse(registries, opts));
    if (badges.length) view.badges = badges;
  }

  return view;
}

/** Build the whole dashboard. Exported for tests. */
export function buildDashboard(registries, config) {
  const opts = options(config);
  const views = [];

  // One name cannot serve six views, and one path certainly cannot, so a dashboard keeps its
  // per-group names. Every other view setting — theme, background — applies to all of them.
  const { title, path, icon, view: perView, ...rest } = config || {};
  const shared = { ...(perView || {}) };
  for (const key of ["title", "path", "icon"]) delete shared[key];
  const viewConfig = { ...rest, view: shared };

  for (const group of GROUPS) {
    const generated = buildView(group, registries, viewConfig);
    // Skip a view with nothing in it rather than showing an empty tab
    if (generated) views.push(generated);
  }

  if (!views.length) return { views: [emptyView(opts)] };

  return { views };
}

async function loadRegistries(hass) {
  const [devices, entities, entries] = await Promise.all([
    hass.callWS({ type: "config/device_registry/list" }),
    hass.callWS({ type: "config/entity_registry/list" }),
    // Only for telling several servers apart; a user without access to config entries still
    // gets a dashboard
    hass.callWS({ type: "config_entries/get", domain: INTEGRATION }).catch(() => []),
  ]);
  return { devices, entities, entries };
}

// customElements.define requires an HTMLElement subclass, but Home Assistant only ever calls
// the static generate(). Resolving the base at runtime keeps the module importable outside a
// browser, which is what makes the build logic testable.
const StrategyBase = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

class VeeamOneDashboardStrategy extends StrategyBase {
  static async generate(config, hass) {
    return buildDashboard(await loadRegistries(hass), config);
  }
}

class VeeamOneViewStrategy extends StrategyBase {
  static async generate(config, hass) {
    const group = GROUPS.includes(config?.group) ? config.group : "overview";
    const view = buildView(group, await loadRegistries(hass), config);

    if (!view) {
      const opts = options(config);
      const empty = markdown("No Veeam ONE entities found.");
      return {
        type: "sections",
        title: opts.title || "Veeam ONE",
        icon: opts.icon || SERVER_ICON,
        sections: [titledSection("Veeam ONE", SERVER_ICON, [empty])],
      };
    }

    return view;
  }
}

// Registered defensively: a dashboard can be reloaded without a full page refresh, and
// defining an existing element throws.
if (typeof customElements !== "undefined") {
  if (!customElements.get("ll-strategy-dashboard-veeam-one")) {
    customElements.define("ll-strategy-dashboard-veeam-one", VeeamOneDashboardStrategy);
  }
  if (!customElements.get("ll-strategy-view-veeam-one")) {
    customElements.define("ll-strategy-view-veeam-one", VeeamOneViewStrategy);
  }
}

console.info("%c VEEAM-ONE-DASHBOARD %c strategy loaded ", "color:white;background:#00b336", "");
