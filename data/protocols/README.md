# Protocol corpus (RAG source for Rafid)

Nine short, **fictional** civil-defense style documents in English (`en/`) and
Arabic (`ar/`). Each file has YAML front matter (`doc_id`, `title`, `version`,
`lang`) and numbered sections (`## 2. …`, `2.3. …`) so that citations such as
`FOC-SOP-01 §2.2` resolve to a real passage in either language.

| doc_id     | Document                                             |
|------------|------------------------------------------------------|
| FOC-SOP-01 | Underpass Closure and Traffic Diversion Protocol     |
| FOC-SOP-02 | Mobile Pump Deployment SOP                           |
| FOC-GDE-03 | Sandbag and Temporary Barrier Placement Guide        |
| FOC-PRC-04 | School and Workplace Advisory Procedure              |
| FOC-CHK-05 | Hospital and Critical Facility Protection Checklist  |
| FOC-TPL-06 | Public SMS Advisory Templates                        |
| FOC-SOP-07 | Evacuation Escalation Ladder                         |
| FOC-PRC-08 | Pre-Storm Drain and Gully Inspection Procedure       |
| FOC-SOP-09 | Power Substation and Metro Entrance Protection       |

`make seed` chunks every document by section into `protocol_chunks`
(Phase 1: text + metadata; Phase 3 adds the embedding column values).
Every document ends with "Fictional training document for demo purposes."
