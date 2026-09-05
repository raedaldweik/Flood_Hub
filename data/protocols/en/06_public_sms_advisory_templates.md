---
doc_id: FOC-TPL-06
title: Public SMS Advisory Templates
version: 2.0
lang: en
---

# Public SMS Advisory Templates

## 1. Purpose

These templates are the only approved wording for public flood advisories sent by SMS or cell broadcast. Consistent wording builds public trust and lets residents act quickly. Any assistant-generated draft must be checked against this document and marked DRAFT until a communications officer approves it.

## 2. Rules for every message

2.1. Maximum 300 characters per language. Each message is sent in Arabic and English.

2.2. Every message contains: the issuing centre, the severity word, the affected zones, one clear action, and the time of the next update.

2.3. Never speculate about casualties or damage. Never name a private business.

2.4. Do not include links in RED messages; networks are congested and people should not be browsing while driving.

## 3. Template YELLOW - Watch

"FLOOD OPS CENTER - YELLOW WATCH for {zones}. Heavy rain expected from {time}. Avoid unnecessary travel, keep away from underpasses and wadis. Next update {next_update}."

## 4. Template ORANGE - Warning

"FLOOD OPS CENTER - ORANGE WARNING for {zones}. Street flooding likely from {time}. Do not drive through standing water. Move vehicles from basements and low ground. Next update {next_update}."

## 5. Template RED - Danger

"FLOOD OPS CENTER - RED ALERT for {zones}. Dangerous flooding now. Stay indoors or on upper floors. Underpasses closed. Call emergency services only for life-threatening situations. Next update {next_update}."

## 6. Template UNDERPASS CLOSURE

"FLOOD OPS CENTER - {underpass_name} underpass CLOSED due to flooding. Use diversion via {route}. Do not remove barriers. Next update {next_update}."

## 7. Template STAND-DOWN

"FLOOD OPS CENTER - Flood alert for {zones} ended at {time}. Roads reopening progressively; drive slowly, watch for debris and displaced manhole covers. Thank you for your cooperation."

## 8. Template SCHOOL ADVISORY

"FLOOD OPS CENTER - Schools in {zones}: {measure} on {date} due to forecast flooding. Follow instructions from your school. Next update {next_update}."

## 9. Approval workflow

9.1. The dispatcher selects the template matching the rule that fired; the placeholders are filled from the rule inputs snapshot.

9.2. The communications officer reviews wording in both languages and approves. The approval, the operator identifier and the send time are written to the decision log with `notified = true`.

9.3. Assistant drafts that deviate from these templates are rejected unless the deviation is required by a specific situation and is approved explicitly.

---
*Fictional training document for demo purposes.*
