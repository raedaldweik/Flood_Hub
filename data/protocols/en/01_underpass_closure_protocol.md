---
doc_id: FOC-SOP-01
title: Underpass Closure and Traffic Diversion Protocol
version: 1.2
lang: en
---

# Underpass Closure and Traffic Diversion Protocol

## 1. Purpose

This protocol defines when and how the Flood Operations Center (FOC) orders the closure of road underpasses and tunnels during heavy rainfall, and how traffic is diverted safely. Underpasses are the single most dangerous flood location in the city: water concentrates from a large catchment into a small, enclosed roadway and depth can rise from ankle height to roof height in under twenty minutes.

## 2. Trigger conditions

2.1. A RED alert issued by the rules engine for any zone flagged `has_underpass` automatically raises a closure action item for every underpass in that zone.

2.2. Independently of zone risk, any underpass shall be closed when the measured or estimated standing water at its low point reaches 15 cm, or when rainfall intensity over the zone exceeds 20 mm/h for two consecutive ten-minute intervals.

2.3. The duty commander may order a precautionary closure at ORANGE alert when the underpass has flooded in either of the last two major storms.

## 3. Closure sequence

3.1. The FOC dispatcher confirms the closure order in the decision log, quoting the rule identifier and the inputs snapshot.

3.2. Traffic police are notified by radio and the closure appears on the dispatch board within two minutes.

3.3. Barriers are placed at both approaches at least 150 m before the descent, so that vehicles can still turn around. Flashing amber beacons are switched on. At night, a lit vehicle is parked across the approach lane.

3.4. Variable message signs on the feeder roads display "UNDERPASS CLOSED - FLOODING - FOLLOW DIVERSION" in Arabic and English.

3.5. A crew checks the underpass for stranded vehicles and occupants before pumps are engaged.

## 4. Diversion plan

4.1. Each underpass has a pre-approved diversion route stored in the zone file. Diversions use surface roads on higher ground and avoid routing through any other zone at ORANGE or RED.

4.2. Where two adjacent underpasses are closed, the diversion coordinator activates the district ring route and requests traffic police at the three critical junctions.

4.3. Emergency vehicle corridors take priority over general traffic diversions.

## 5. Reopening

5.1. An underpass is reopened only after the standing water is below 5 cm, the pavement has been inspected for debris and displaced manhole covers, and the drainage inlets are confirmed clear.

5.2. Reopening is a logged decision approved by the duty commander; it is never automatic.

## 6. Records

Every closure and reopening is recorded in the decision log with timestamp, zone, rule identifier and version, the inputs that fired the rule, the approving officer, and the notification channel used.

---
*Fictional training document for demo purposes.*
