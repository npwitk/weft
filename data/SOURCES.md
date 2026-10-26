# Where the networks come from

The lab's code is MIT. These data files aren't: each keeps its source's terms.

## From OpenStreetMap, via Pinwake

`bangkok.json`, `singapore.json`: rail lines and stations from
OpenStreetMap, built by Pinwake's `Design/RailData/fetch_*_rail.py`. They
include Pinwake's hand-traced diagram positions (`sx`, `sy`, `path`), used
as the "Hand-traced" reference style.

© OpenStreetMap contributors, available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

## From LOOM's examples

`berlin.json`, `chicago.json`, `freiburg.json`, `stuttgart.json`,
`sydney.json`, `wien.json`: converted with `scripts/import_loom.py` from
the example line graphs in [LOOM](https://github.com/ad-freiburg/loom)
(`examples/*.json`), by Patrick Brosi and the University of Freiburg's
Chair of Algorithms and Data Structures. LOOM is GPL-3.0. Its example graphs
were generated from each city's public GTFS feed:

| File | Network | Original data |
|---|---|---|
| berlin.json | Berlin U-Bahn | VBB GTFS |
| chicago.json | Chicago 'L' | CTA GTFS |
| freiburg.json | Freiburg trams | VAG Freiburg GTFS |
| stuttgart.json | Stuttgart Stadtbahn | VVS GTFS |
| sydney.json | Sydney Trains | Transport for NSW GTFS |
| wien.json | Vienna U-Bahn | Wiener Linien GTFS |

**Before publishing:** check each feed's current licence (most of these
publishers use CC BY 4.0 or similar open terms, and CTA has its own developer
terms). Also check whether LOOM's authors are happy for the converted
graphs to be redistributed. If in doubt, ship `scripts/import_loom.py` and
fetch the examples at setup instead of committing these files.

To regenerate:

```
curl -LO https://raw.githubusercontent.com/ad-freiburg/loom/master/examples/berlin.json
python3 -I scripts/import_loom.py berlin.json data/berlin.json "Berlin U-Bahn"
```
