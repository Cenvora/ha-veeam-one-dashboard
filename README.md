<h1 align="center">
<br>
<img src="https://raw.githubusercontent.com/Cenvora/ha-veeam-one/main/custom_components/veeam_one/brand/logo.png"
     alt="Veeam Logo"
     height="100">
<br>
<br>
Veeam ONE Dashboard
</h1>

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)

An auto-generating Home Assistant dashboard for the
[Veeam ONE integration](https://github.com/Cenvora/ha-veeam-one). It reads the device and
entity registries at render time and builds views from whatever the integration has created, so
jobs, repositories and monitored platforms appear and disappear on their own, with no dashboard
YAML to maintain.

This project is an independent, open source project. It is not affiliated with, endorsed by, or
sponsored by Veeam Software.

## Requirements

- Home Assistant 2026.8 or newer, the same minimum as the integration
- The [ha-veeam-one](https://github.com/Cenvora/ha-veeam-one) integration (0.2.0 or later), set
  up and producing entities

## Installation

### HACS (recommended)

Have [HACS](https://hacs.xyz/) installed, then use this button:

[![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Cenvora&repository=ha-veeam-one-dashboard&category=plugin)

Click **Download**, then reload your browser.

> [!NOTE]
> This is not in the default HACS store yet. If the button above doesn't work, add
> `https://github.com/Cenvora/ha-veeam-one-dashboard` as a custom repository of type
> **Dashboard** in HACS → ⋮ → **Custom repositories**, then download it from there.
>
> The type is called **Dashboard** in the HACS interface but `plugin` everywhere machine
> readable: the install button above, `hacs.json` and the CI workflow all use `plugin`.
> HACS maps the two (`common.type.plugin` = "Dashboard"); they are not different categories.

HACS registers the dashboard resource for you, so there is nothing to add by hand.

<details><summary>Manual install</summary>

1. Copy `veeam-one-dashboard.js` from the
   [latest release](https://github.com/Cenvora/ha-veeam-one-dashboard/releases/latest) into
   `<config>/www/`
2. Add it under **Settings → Dashboards → ⋮ → Resources** as `/local/veeam-one-dashboard.js`,
   type **JavaScript module**
3. Reload your browser

</details>

## Usage

### A whole dashboard

**Settings → Dashboards → Add dashboard → New dashboard from scratch**, then ⋮ → **Raw
configuration editor**, and replace the contents with:

```yaml
strategy:
  type: custom:veeam-one
```

That's the entire configuration. You get up to six views:

| View | Contents |
| ---- | -------- |
| **Overview** | A live headline, Connected / Active alarms / License days remaining badges, and one tile per job, repository, server and proxy |
| **Alarms** | The alarm counts and a table of every active alarm (status, name, object, time, ID), ready for the `veeam_one.resolve_alarm` action |
| **Jobs** | A section per VBR backup, replication and backup copy job and per Microsoft 365 backup and copy job |
| **Repositories** | A section per VBR repository, Microsoft 365 repository and object storage repository, with free space as a gauge |
| **Infrastructure** | VBR backup servers, Microsoft 365 servers and proxies, the Veeam ONE server itself and its licensing |
| **Inventory** | What Veeam ONE counts on each platform it monitors (Backup & Replication, Cloud Connect, Microsoft 365, vSphere, Cloud Director, Hyper-V, public cloud), with each collection's Problem and Health |

Views with nothing to show are left out, so a Veeam ONE that monitors no Microsoft 365 does not
get empty Microsoft 365 sections, and one with no repositories gets no Repositories tab.

### Alarms

The integration keeps triggered alarms on the Veeam ONE device rather than giving each one a
device: **Active alarms** counts those with status Error or Warning and lists them, newest first,
in its `alarms` attribute. The Alarms view reads that attribute live:

```
Alarms
[Active alarms: 3]   [Error alarms: 1]   [Warning alarms: 2]
| Status    | Alarm                   | Object | Triggered        |   ID |
| **Error** | Backup job state ×3     | vm01   | 2026-09-29 10:00 | 1234 |
| Warning   | Repository free space   | repo01 | 2026-09-29 08:12 | 1235 |
Resolve alarms with the veeam_one.resolve_alarm action, passing the IDs above as alarm_ids.
```

The integration caps the attribute at 50 alarms, and the table says so when there are more. A
dashboard card cannot pass a live list of IDs to an action, so resolving is left to the action
itself, from **Developer tools → Actions** or an automation:

```yaml
action: veeam_one.resolve_alarm
data:
  alarm_ids: [1234, 1235]
  comment: Fixed the proxy
```

With more than one Veeam ONE server, each server gets its own Alarms section, and the note names
the `config_entry_id` to pass with its IDs.

### The headline

The top of the overview is a template, so it follows live states. From top to bottom it says:

- **Veeam ONE is not answering**, as an error banner, while **Connected** is off. Every other
  entity is unavailable then.
- The alarm count: *1 error alarm*, *2 warning alarms* or *No active alarms*, with the split
  underneath.
- How many jobs, repositories, servers and proxies report a problem, and which ones, counted from
  the same **Problem** sensors the device sections show.
- Repositories below `free_space_warn_at` percent free, and a warning banner for any whose
  **Days until out of space** is at or below `out_of_space_warn_days`.
- The license: an error banner once **License expired** is on, a warning once **License days
  remaining** drops below `license_warn_days`, and a warning when support has expired.

### A single view in an existing dashboard

Two editors take two different shapes, and pasting one into the other is the usual cause of an
empty view.

**Dashboard ⋮ → Raw configuration editor**: the whole dashboard, so views are a list:

```yaml
views:
  - strategy:
      type: custom:veeam-one
      group: alarms
      title: Veeam alarms
      icon: mdi:alarm-light
  - title: Something else of your own
    cards: []
```

**A single view → Edit view → ⋮ → Edit in YAML**: one view, so there is no `views:` key and no
`type:`/`sections:` of your own:

```yaml
strategy:
  type: custom:veeam-one
  group: alarms
  title: Veeam alarms
  icon: mdi:alarm-light
```

`group` accepts `overview`, `alarms`, `jobs`, `repositories`, `infrastructure` or `inventory`.

> [!IMPORTANT]
> Set the view's **name, icon and theme inside the `strategy:` block**, as above. Don't set them
> beside it, and don't use the visual editor for them.
>
> Home Assistant applies a strategy's generated configuration *over* the view's own keys, so a
> `title:` next to `strategy:` is ignored and the tab reads *Unnamed view*. Using the visual
> editor to rename or restyle the view replaces the strategy with a static copy of the cards it
> generated at that moment, and the dashboard stops updating itself. That is how strategies work
> in Home Assistant generally, not something specific to this one.
>
> `title`, `path`, `icon`, `theme`, `background`, `subview` and `visible` are accepted directly.
> Anything else Home Assistant supports on a view goes under `view:`, which is passed through
> untouched:
>
> ```yaml
> strategy:
>   type: custom:veeam-one
>   view:
>     theme: midnight
>     top_margin: true
> ```

### Options

All optional, and valid on either the dashboard or a view strategy:

| Option | Default | What it does |
| ------ | ------- | ------------ |
| `title`, `icon`, `path` | per view | Name a generated view. The whole-dashboard strategy names its own views, so it ignores these |
| `theme`, `background`, `subview`, `visible` | none | Standard view settings. On the dashboard strategy they apply to every view |
| `view` | none | Any other view setting, passed through verbatim |
| `summary` | `true` | The live headline described above |
| `badges` | `true` | Show Connected, Active alarms and License days remaining as badges instead of a section |
| `columns` | `3` | Maximum section columns |
| `include_diagnostics` | `false` | Include diagnostic entities, such as License company and the disabled-by-default Average run duration, Processed items and Running tasks once you enable them. Version and the license type, package and instance count are shown either way |
| `include_hidden` | `false` | Include entities you have hidden |
| `free_space_warn_at` | `15` | Free-space percentage below which a repository is low, in the headline and on the gauges |
| `out_of_space_warn_days` | `7` | Days until out of space at or below which the headline warns |
| `license_warn_days` | `30` | License days remaining below which the headline and Licensing section warn. 30 matches the integration's repair issue |
| `license_warn_at` | `90` | License unit used percentage where the usage gauges turn yellow |

```yaml
strategy:
  type: custom:veeam-one
  free_space_warn_at: 20
  license_warn_days: 60
  columns: 2
```

### Multiple Veeam ONE servers

Each server is its own config entry, and all of them are picked up. Every Veeam ONE server device
is called *Veeam ONE*, so when more than one is configured the strategy also reads the config
entries, which the integration titles *Veeam ONE (host)*, and suffixes section titles and badges
with the host: *Alarms — one.example.com*, *Nightly VMs (two.example.com)*. A name you give a
server device yourself is used instead of the host. The headline counts across all servers.

## How it works

The strategy asks Home Assistant for the device and entity registries (and the integration's
config entries, for the server labels), keeps entities whose platform is `veeam_one`, and groups
their devices by model:

| Model | Shown on |
| ----- | -------- |
| `Veeam ONE` (the server) | Overview badges, Alarms, Infrastructure (Veeam ONE and Licensing), Inventory |
| `VBR Backup Job`, `VBR Replication Job`, `VBR Backup Copy Job`, `Microsoft 365 Backup Job`, `Microsoft 365 Copy Job` | Overview, Jobs |
| `VBR Repository`, `Microsoft 365 Repository`, `Microsoft 365 Object Storage Repository` | Overview, Repositories |
| `VBR Backup Server`, `Microsoft 365 Server`, `Microsoft 365 Backup Proxy` | Overview, Infrastructure |

Within a device, an entity is recognised by its translation key, which the integration sets on
every entity. Registries that don't report one fall back to the unique ID (`<entry>_<key>`, the
same in every version of the integration), then to the end of the entity ID, ignoring a `_2` Home
Assistant added to resolve a clash. Renaming an entity or a device therefore does not break the
dashboard, and disabled entities never get a tile that would render broken.

A few deliberate choices in the layout:

- **One tile per device on the overview**, named for the device. Jobs and servers lead with
  **Status**, which reads *Success* or *Failed* and says more than the Problem sensor's *OK*.
  Repositories lead with **Free space percentage**.
- **Short names inside a device section.** Device names are *Veeam ONE Nightly VMs*; under a
  *Backup jobs* heading the title reads *Nightly VMs*, and its tiles read *Status*, *Problem* and
  *Last run*, not the full friendly name repeated each time.
- **Free space is a gauge**, red below `free_space_warn_at` − 10, yellow up to
  `free_space_warn_at`, green above. Capacity, free and used space share one row, as do the last
  run's duration, transferred data and processed items.
- **The server device is split up.** The integration puts the server's connection, alarms,
  license and a count of every monitored collection on one device. Rather than one section of
  fifty tiles, these become the Alarms view, the Veeam ONE and Licensing sections, and the
  Inventory view. A server entity none of them claims still appears in the Veeam ONE section.
- **Per-collection Problem sensors stay on the Inventory view.** The headline counts each job's
  own Problem sensor. Counting *VBR Backup Jobs problem* as well would count every job twice.
- **The headline and the banners are templates**, not counts baked in at render time. A strategy
  runs once per page load, so anything computed from live states would be a stale snapshot
  minutes later. The same goes for card order and colour, which is why neither depends on state.
  The license and connection banners are always present and shown or hidden by Home Assistant's
  own visibility conditions.

## Development

Plain ES module, no build step, no dependencies. The file you edit is the file Home Assistant
loads.

```bash
node --test        # or: npm test
```

The tests import the module directly and feed it registry fixtures shaped like the integration's
(translation keys, `<entry>_<key>` unique IDs, entity IDs from the device name), asserting on the
generated dashboard configuration: grouping, filtering, identification by translation key,
unique ID and entity ID, multi-server labelling, the alarm table, licensing, the inventory, and
the empty state.

## Related

- [ha-veeam-one](https://github.com/Cenvora/ha-veeam-one), the integration that produces the
  entities
- [ha-veeam-br-dashboard](https://github.com/Cenvora/ha-veeam-br-dashboard) and
  [ha-veeam-365-dashboard](https://github.com/Cenvora/ha-veeam-365-dashboard), the same kind of
  dashboard for the Veeam Backup & Replication and Veeam Backup for Microsoft 365 integrations,
  which can also start jobs and rescan repositories

## License

MIT, see [LICENSE](LICENSE).
