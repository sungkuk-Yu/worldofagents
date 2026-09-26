# MyAgentTalk Privacy Policy

> **⚠️ DRAFT — NOT IN EFFECT**
> Prepared by: My Lawyer (hammurabi) agent | Date: 2026-09-26 | Version: v0.1-draft
> Basis: `docs/legal/mvp-legal-review.md` (commit 0b5dd10d) §1 + backend code measurement (schema 001/002, config.ts, stt.ts, llm.ts)
>
> **This document is an internal draft and does not constitute legal advice. Before public launch, have it reviewed by qualified counsel — in particular for U.S. state privacy laws (e.g., CCPA/CPRA notice requirements) and cross-border transfer wording.** Fill in all `[TO BE CONFIRMED]` placeholders.

| Item | Value |
|---|---|
| Company (data controller) | [TO BE CONFIRMED] |
| Privacy contact / DPO | [TO BE CONFIRMED — email required] |
| Effective date / Version | [LAUNCH DATE] / v0.1 |

---

[COMPANY] ("we," "us") operates **MyAgentTalk**, a chat service where you converse with a personalized AI agent. This Privacy Policy explains what information we collect, why, how long we keep it, where it goes, and the rights you have. It applies to the MyAgentTalk mobile app and related services.

**The single most important thing to know:** because MyAgentTalk is built on third-party AI infrastructure, **the content of your conversations and any voice input you send are transmitted to and processed by AI providers outside your country** (see Section 5, International Transfers). Please read that section before using the Service.

## 1. Information We Collect

**(Measured against the live codebase as of 2026-09-26.)**

| Category | What it includes | When |
|---|---|---|
| Account data | Email address; password (stored only in encrypted, non-reversible form) | Sign-up |
| Profile data | Display name; phone number (optional); timezone and language; optional profile traits you choose to enter (e.g., MBTI, interests) used to personalize your agent | Sign-up / profile setup |
| Agent configuration | Names, personas, voice and tone settings you create for your agents | Service use |
| **Conversation content** | The full text of messages you send and agent responses, including thread and fork history | Chat use |
| **Voice data** | When you use voice input, your audio is streamed to a speech-to-text provider and converted to text. **We do not store the audio itself on our servers** — it is processed in memory and discarded once transcribed. The resulting transcript is treated as conversation content | Voice input |
| Usage data | Session and message timestamps, feature interactions, feedback (like/dislike), device information, IP address | Service use |
| Subscription data | Subscription status and payment records. We do not store card numbers — payment details are processed directly by our payment processor or app store | Paid purchases |
| Consent records | Which consents you gave, at what time, and which policy version | Sign-up |

**What we do not collect:** government identifiers (e.g., Social Security or national ID numbers), precise geolocation, biometric identifiers, or sensitive personal information. Voice audio is used solely for transcription — **we do not create voiceprints or use your voice for biometric identification.** We do not knowingly collect information from children under 14 (or the applicable minimum age); the Service is not directed to children.

## 2. How We Use Information

1. To provide and operate the Service (accounts, conversations, agent memory, personalization);
2. To process subscriptions, payments, and refunds;
3. To secure the Service, prevent abuse, and debug problems;
4. To comply with legal obligations;
5. With your separate opt-in consent, to send marketing communications (you can opt out at any time; refusing does not affect the Service).

**We do not use your conversation content to train AI models** — neither ours nor third parties'. Conversation content is sent to AI providers solely to generate your responses. If we ever change this, we will ask for your explicit consent first (or use de-identified/aggregated data where the law permits) and update this Policy.

**We do not sell your personal information**, and we do not share it with advertisers.

## 3. Legal Bases (for EEA/UK/Korea users)

| Processing | Basis |
|---|---|
| Account, conversation, and core service processing | Performance of the contract with you |
| Security logs, consent records | Legal obligation / legitimate interests |
| Marketing | Consent (opt-in) |
| International transfers | Consent and/or contractual necessity, plus vendor DPAs (Section 5) |

## 4. Data Retention and Deletion

| Data | Retention |
|---|---|
| Account, profile, agent settings | Until you delete your account |
| Conversation content (messages, raw transcripts, compressed memories, context records) | While your account is active — retained to power the agent's memory features. [TO BE CONFIRMED: an upper retention bound for raw transcripts of inactive accounts, e.g., N months after last activity — indefinite retention is not permitted under Korean law] |
| Voice audio | Not stored; discarded immediately after transcription |
| Transaction / consent records | As required by law (e.g., Korea's E-Commerce Act: 5 years for contract and payment records) |
| Network access logs | As required by law (Korea: 3 months) |

**When you delete your account, we delete your personal data — including the full text of your conversations and raw transcripts — promptly and permanently** (database rows are cascade-deleted; residual copies in backups expire on the backup rotation cycle). Deletion is irreversible. Data we must keep for legal reasons is segregated and used only for that purpose.

## 5. International Data Transfers — Please Read

We are based in [Korea — TO BE CONFIRMED]. To make the Service work, your data is transferred to and processed in other countries:

| Recipient (Country) | Data transferred | Purpose |
|---|---|---|
| **Supabase, Inc.** — data stored in **Tokyo, Japan (ap-northeast-1)** (verified) | Account data, profile, full conversation content, agent settings, usage records | Database hosting and operation |
| **OpenAI** — **United States** | Voice input audio (for transcription) | Speech-to-text (Whisper API). OpenAI's API terms state that API inputs/outputs are not used to train models; audio is retained only briefly for processing/abuse-monitoring purposes [per OpenAI policy — reconfirm at launch] |
| **Alibaba Cloud (DashScope)** — Singapore [estimated — to be confirmed with Alibaba before publishing] | Conversation content (prompts and recent history) | AI response generation (language model API). DashScope's international terms state API data is not used for model training [reconfirm at launch] |

Transfers are made under contractual data-processing agreements with these providers. For users in Korea, separate consent to international transfer is requested at sign-up, as required by the Personal Information Protection Act (Article 28-8). **You may decline international transfers — but because they are essential to the Service's core function (AI responses, voice transcription, data storage), declining means you cannot use the Service.**

## 6. Service Providers

We use the following categories of service providers, who process data only on our documented instructions: cloud database hosting (Supabase), AI inference providers (OpenAI, Alibaba Cloud), payment processors [TO BE CONFIRMED — name at launch], and email/notification services [TO BE CONFIRMED]. We do not authorize them to use your data for their own purposes.

## 7. Your Rights

Depending on where you live, you may have the right to **access, correct, delete, restrict processing of, obtain a copy of, or object to the processing of** your personal information, and to withdraw consent at any time.

**How to exercise them:**
- **Access / correction**: in-app — your profile screen and full conversation history are visible to you.
- **Deletion**: in-app — delete individual conversations, or delete your entire account under Settings → "Delete account" (immediate, irreversible).
- **Marketing opt-out**: in-app settings or the unsubscribe link in emails.
- **Anything else, or requests on behalf of another user**: email [TO BE CONFIRMED]. We will verify your identity and respond within 10 business days (30 days where law allows, e.g., CCPA's 45-day framework).

We will not discriminate against you for exercising your privacy rights.

**California residents (CCPA/CPRA):** you have the right to know, delete, correct, opt out of "sale"/"sharing" (we do neither), and limit use of sensitive personal information (we collect none). **Korean residents:** you have rights under the PIPA including access, correction, deletion, suspension of processing, and withdrawal of consent, exercisable as above or through our privacy contact.

## 8. Data Security

We implement administrative, technical, and physical safeguards proportionate to the sensitivity of the data: encryption in transit (TLS) and encrypted password storage; database row-level security so users can access only their own data; least-privilege access for our personnel; and access logging. No system is perfectly secure, however, and we cannot guarantee absolute security.

**Breach notification:** if a breach of personal data occurs, we will notify affected users and relevant regulators without undue delay and in accordance with applicable law (e.g., within 72 hours to Korea's Personal Information Protection Commission where required).

## 9. Children's Privacy

The Service is not intended for children under 14 (or the minimum age of digital consent in your jurisdiction). We do not knowingly collect children's data; if we learn we have, we will delete it promptly. Contact us at [TO BE CONFIRMED].

## 10. Cookies and Analytics

The Service does not currently use advertising trackers or third-party advertising cookies. [TO BE CONFIRMED: if product analytics are added at launch, disclose them here.]

## 11. Changes to This Policy

We will post updates here with a new version and effective date. For material changes (especially to data categories, retention, or international transfers), we will give at least 7 days' notice in-app or by email (30 days for changes significantly affecting your rights).

| Version | Effective | Summary of changes |
|---|---|---|
| v0.1 | [LAUNCH DATE] | Initial draft |

## 12. Contact Us

- Privacy contact / DPO: [TO BE CONFIRMED]
- Company: [TO BE CONFIRMED]
- For Korean users, our Personal Information Protection Officer is [TO BE CONFIRMED]; you may also contact Korea's Privacy Infringement Center (privacy.kisa.or.kr, 118).

---

*This document is an internal draft, not legal advice. Retain qualified counsel to review before launch — especially the international-transfer structure (processor/위탁 vs. transfer) and retention caps (docs/legal/mvp-legal-review.md §11①).*
