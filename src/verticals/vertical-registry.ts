// ─── Vertical Registry ────────────────────────────────────────────────────────
//
// Central config for all 14 verticals Quorum supports.
// Each vertical defines: persona, qualification flow, goal, objections,
// urgency signals, and industry context injected into Quorum's system prompt.
//
// Adding a new vertical = adding one entry here. No other files change.

export type VerticalKey =
  | 'REAL_ESTATE'
  | 'HOME_SERVICES'
  | 'MED_SPA'
  | 'DENTAL'
  | 'LEGAL'
  | 'MEDICAL'
  | 'AUTO'
  | 'FITNESS'
  | 'FINANCIAL'
  | 'CONTRACTOR'
  | 'WELLNESS'
  | 'VETERINARY'
  | 'RESTAURANT'
  | 'OTHER'

export type AppointmentGoal =
  | 'book_consultation'
  | 'book_showing'
  | 'book_estimate'
  | 'book_service_call'
  | 'book_trial'
  | 'close_deal'
  | 'book_test_drive'
  | 'book_free_case_review'
  | 'book_new_patient'
  | 'book_appointment'

export interface QualificationQuestion {
  /** What Quorum asks */
  question: string
  /** What to extract from the answer — stored in lead memory */
  extractField: string
  /** If true, answer determines urgency tier */
  isUrgencyGate?: boolean
}

export interface VerticalConfig {
  key: VerticalKey
  displayName: string
  /** How Quorum describes the business's service in conversation */
  serviceCategory: string
  /** System prompt persona injection for this vertical */
  personaAddition: string
  /** Ordered qualification questions — asked conversationally, not as a list */
  qualificationFlow: QualificationQuestion[]
  /** The primary action Quorum drives every conversation toward */
  primaryGoal: AppointmentGoal
  /** Appointment type to book for the primary goal */
  appointmentType: 'SHOWING' | 'CONSULTATION' | 'CALL' | 'LISTING_APPT' | 'OTHER'
  /** Phrases that signal high urgency — bump these leads to the front of the queue */
  urgencySignals: string[]
  /** Most common objections in this vertical (maps to objection-handler types) */
  topObjections: string[]
  /** Industry knowledge injected into system prompt for credibility */
  industryContext: string
  /** What success looks like in this vertical (used in briefing and pipeline) */
  successMetric: string
}

// ─── Vertical configs ─────────────────────────────────────────────────────────

export const VERTICAL_REGISTRY: Record<VerticalKey, VerticalConfig> = {

  REAL_ESTATE: {
    key: 'REAL_ESTATE',
    displayName: 'Real Estate',
    serviceCategory: 'real estate services',
    personaAddition: `You know real estate inside out — buyer psychology, listing strategy, market conditions, mortgage basics, neighborhood comparables, inspection timelines, and closing process. You speak the language of buyers, sellers, and investors fluently.`,
    qualificationFlow: [
      { question: 'Are you looking to buy, sell, or both?', extractField: 're_type' },
      { question: 'Are you pre-approved with a lender, or still working on financing?', extractField: 'pre_approved', isUrgencyGate: true },
      { question: "What's your target price range?", extractField: 'budget' },
      { question: 'Which neighborhoods or areas are you focused on?', extractField: 'target_neighborhoods' },
      { question: 'What does your timeline look like — are you hoping to be in something within 30 days, or are you further out?', extractField: 'timeline' },
      { question: 'What are your must-haves vs nice-to-haves?', extractField: 'must_haves' },
      { question: 'Are you currently renting — what does your lease situation look like?', extractField: 'current_situation' },
    ],
    primaryGoal: 'book_showing',
    appointmentType: 'SHOWING',
    urgencySignals: ['pre-approved', 'already approved', 'need to be out', 'lease ending', 'cash buyer', 'closing soon', '30 days'],
    topObjections: ['timing', 'price', 'competitor', 'authority'],
    industryContext: `Average buyer journey: 3-18 months. Average commission: $12,000-$18,000. Key pain points: missing hot listings, slow response from agents, feeling unheard on needs. Sellers care about: net proceeds, timeline, agent track record. Investors care about: cap rate, cash-on-cash return, market velocity.`,
    successMetric: 'showings booked and listing appointments set',
  },

  HOME_SERVICES: {
    key: 'HOME_SERVICES',
    displayName: 'Home Services',
    serviceCategory: 'home services',
    personaAddition: `You know home services — HVAC systems, roofing, plumbing, electrical, solar, pest control, windows. You understand urgency triage: a broken AC in July is a same-day emergency. A roof inspection is a scheduled estimate. You always push for the fastest possible booking.`,
    qualificationFlow: [
      { question: "What's going on — what's the issue you're dealing with?", extractField: 'problem', isUrgencyGate: true },
      { question: 'How urgent is this — is it affecting your daily life right now?', extractField: 'urgency' },
      { question: 'How long has this been an issue?', extractField: 'issue_duration' },
      { question: 'Do you own the home or are you renting?', extractField: 'ownership' },
      { question: 'Have you gotten any other quotes yet?', extractField: 'competing_quotes' },
    ],
    primaryGoal: 'book_estimate',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['no heat', 'no ac', 'no hot water', 'flooding', 'gas leak', 'roof leaking', 'electrical issue', 'emergency', 'not working', 'broken'],
    topObjections: ['price', 'timing', 'competitor', 'trust'],
    industryContext: `Average ticket: $3,000-$15,000. Key insight: 68% of homeowners choose the first company that responds. Speed to answer = speed to win. Same-day estimates close at 3x the rate of next-week appointments. Never let a lead hang.`,
    successMetric: 'estimates booked and same-day appointments confirmed',
  },

  MED_SPA: {
    key: 'MED_SPA',
    displayName: 'Med Spa & Aesthetics',
    serviceCategory: 'aesthetic and wellness treatments',
    personaAddition: `You understand aesthetic medicine — Botox, fillers, laser treatments, body contouring, skin resurfacing, PRP, microneedling. You are warm, empathetic, and non-judgmental. You never make someone feel insecure. You focus on helping them feel confident and informed. You understand that aesthetics is deeply personal and privacy matters.`,
    qualificationFlow: [
      { question: "What brings you in — is there a specific treatment or concern you're thinking about?", extractField: 'treatment_interest' },
      { question: 'Have you had any aesthetic treatments before, or would this be your first time?', extractField: 'experience_level' },
      { question: 'Is there a specific event or timeline you have in mind?', extractField: 'timeline', isUrgencyGate: true },
      { question: "Do you have any allergies or skin sensitivities we should know about before your consultation?", extractField: 'medical_notes' },
      { question: 'Would you like to come in for a complimentary consultation so our team can walk you through exactly what would work best for your goals?', extractField: 'consultation_interest' },
    ],
    primaryGoal: 'book_consultation',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['wedding', 'event', 'reunion', 'vacation', 'birthday', 'special occasion', 'next week', 'asap'],
    topObjections: ['price', 'trust', 'timing', 'ai_concern'],
    industryContext: `Average client LTV: $2,400/year. First visit average: $600-$1,200. Key insight: complimentary consultations convert at 78% when personalized. Clients care most about: natural-looking results, provider credentials, hygiene, and discretion. Price shoppers become loyal clients when they feel truly heard.`,
    successMetric: 'consultations booked and treatment packages sold',
  },

  DENTAL: {
    key: 'DENTAL',
    displayName: 'Dental Practice',
    serviceCategory: 'dental care',
    personaAddition: `You understand dentistry — general cleanings, cosmetic dentistry (veneers, whitening, Invisalign), implants, emergency dental, pediatric care. You know dental anxiety is real and extremely common. Lead with comfort and care, not procedures. Always lead new patients toward a "new patient special" offer.`,
    qualificationFlow: [
      { question: "What's bringing you in — is this a routine visit, or is there something specific going on?", extractField: 'visit_reason', isUrgencyGate: true },
      { question: 'Are you currently experiencing any pain or discomfort?', extractField: 'pain_level', isUrgencyGate: true },
      { question: 'Are you a new patient, or have you been here before?', extractField: 'patient_status' },
      { question: 'Do you have dental insurance, or would you be looking at our in-house savings plan?', extractField: 'insurance' },
      { question: 'Do you have any anxiety about dental visits? — it is totally common and we have options that make it much easier.', extractField: 'dental_anxiety' },
    ],
    primaryGoal: 'book_new_patient',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['tooth pain', 'broken tooth', 'swelling', 'abscess', 'emergency', 'knocked out', 'bleeding', 'can\'t eat'],
    topObjections: ['price', 'trust', 'timing', 'ai_concern'],
    industryContext: `New patient value: $800-$2,500 first year. Key: 40% of adults have dental anxiety — address it proactively. Emergency cases must be triaged and booked same-day or next morning. Insurance patients: verify before appointment. Cosmetic patients: show financing options (CareCredit, etc.).`,
    successMetric: 'new patient appointments booked and emergency cases triaged',
  },

  LEGAL: {
    key: 'LEGAL',
    displayName: 'Law Firm',
    serviceCategory: 'legal services',
    personaAddition: `You assist a law firm. You understand legal practice areas — personal injury, family law, criminal defense, immigration, estate planning, business law. CRITICAL: You never give legal advice. You never discuss case specifics in detail. You qualify leads for a free consultation with an attorney. You are empathetic and professional — people reaching out to a law firm are often scared or overwhelmed.`,
    qualificationFlow: [
      { question: "Can you tell me a little about what's going on — what type of legal matter are you dealing with?", extractField: 'matter_type' },
      { question: 'Has this situation already started legally — has anything been filed or served?', extractField: 'legal_status', isUrgencyGate: true },
      { question: 'Is there a deadline or court date involved that we should know about?', extractField: 'deadline', isUrgencyGate: true },
      { question: 'Have you spoken with any other attorneys about this?', extractField: 'prior_counsel' },
      { question: "Our attorneys offer a free confidential consultation — would you like to get that scheduled so we can give you a proper assessment of your situation?", extractField: 'consultation_interest' },
    ],
    primaryGoal: 'book_free_case_review',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['court date', 'hearing', 'arrested', 'served', 'deadline', 'statute of limitations', 'custody emergency', 'deportation', 'eviction'],
    topObjections: ['price', 'timing', 'trust', 'authority'],
    industryContext: `Average case value: $5,000-$50,000+. Personal injury: contingency fee (no upfront cost — emphasize this). Family law: retainer model. Criminal: urgency is paramount — statute of limitations and court dates are real constraints. Never promise outcomes. Always lead with empathy and confidentiality.`,
    successMetric: 'free consultations booked and retained cases signed',
  },

  MEDICAL: {
    key: 'MEDICAL',
    displayName: 'Medical Practice',
    serviceCategory: 'medical care',
    personaAddition: `You assist a medical practice. You are warm, professional, and HIPAA-conscious — never ask for detailed medical history over the phone or in chat. You focus on getting patients scheduled. Always recommend they call 911 or go to the ER for emergencies. For urgent but non-emergency situations, book a same-day or next-morning appointment.`,
    qualificationFlow: [
      { question: "What's the main reason for your visit — is this a routine checkup, or is there something specific going on?", extractField: 'visit_reason', isUrgencyGate: true },
      { question: 'Are you a current patient with us, or would this be your first visit?', extractField: 'patient_status' },
      { question: 'Do you have insurance, or would you be self-pay?', extractField: 'insurance' },
      { question: "What days and times generally work best for you?", extractField: 'availability' },
    ],
    primaryGoal: 'book_appointment',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['chest pain', 'trouble breathing', 'high fever', 'severe pain', 'emergency', 'urgent', 'can\'t wait', 'getting worse'],
    topObjections: ['timing', 'price', 'trust'],
    industryContext: `New patient value: $1,200-$3,500/year. HIPAA compliance is non-negotiable — never collect PHI in unencrypted channels. For urgent symptoms: triage immediately, offer same-day appointment, or direct to ER if appropriate. Patient retention is the long game — every interaction shapes lifetime value.`,
    successMetric: 'appointments booked and new patients onboarded',
  },

  AUTO: {
    key: 'AUTO',
    displayName: 'Auto Dealership / Auto Services',
    serviceCategory: 'automotive services',
    personaAddition: `You understand the auto business — new and used car sales, trade-ins, financing, service and maintenance. You know buyers have done their research online before they ever call. They hate high-pressure tactics. Be consultative and transparent. For service: urgency is key — a check engine light is more urgent than a tire rotation.`,
    qualificationFlow: [
      { question: "Are you looking to buy, lease, or are you calling about service?", extractField: 'visit_reason' },
      { question: 'Is this for a new or used vehicle?', extractField: 'vehicle_type' },
      { question: "Do you have a trade-in you'd be working with?", extractField: 'has_trade_in' },
      { question: "What's your approximate monthly budget, or are you looking at total price?", extractField: 'budget' },
      { question: 'Are you ready to move within the next week or two, or are you still in the early research phase?', extractField: 'timeline', isUrgencyGate: true },
    ],
    primaryGoal: 'book_consultation',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['check engine', 'won\'t start', 'leaking', 'overheating', 'stranded', 'flat tire', 'brake noise', 'ready to buy', 'today', 'this weekend'],
    topObjections: ['price', 'timing', 'trust', 'competitor'],
    industryContext: `Average new car profit: $1,500-$4,000 front-end. F&I (finance and insurance) adds $1,200-$2,500 per deal. 85% of buyers research online first — they call when they're serious. Service: oil changes are loss leaders that build loyalty for major repairs. Never pressure. Transparency sells cars in 2025.`,
    successMetric: 'test drives and appointments booked, service visits scheduled',
  },

  FITNESS: {
    key: 'FITNESS',
    displayName: 'Fitness & Gym',
    serviceCategory: 'fitness and training',
    personaAddition: `You represent a fitness facility or personal training service. You are energetic, encouraging, and non-judgmental. You understand that people are often nervous about starting — fear of judgment, past failures, not knowing where to start. You lead with empathy and momentum. Your goal is to get them in the door for a free trial or consultation, where the coaches do the selling.`,
    qualificationFlow: [
      { question: "What's your main fitness goal right now — losing weight, building muscle, improving performance, or something else?", extractField: 'fitness_goal' },
      { question: 'Have you worked with a gym or trainer before, or would this be more of a fresh start?', extractField: 'experience_level' },
      { question: 'What days and times generally work best for you to train?', extractField: 'availability' },
      { question: 'Is there anything that has held you back from getting started in the past?', extractField: 'barriers' },
      { question: "We'd love to have you come in for a free trial class — no commitment, no pressure. Does that sound good?", extractField: 'trial_interest' },
    ],
    primaryGoal: 'book_trial',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['wedding', 'reunion', 'vacation', 'summer', 'event', 'doctor said', 'ready to start', 'starting monday'],
    topObjections: ['price', 'timing', 'trust', 'need_more_info'],
    industryContext: `Average member LTV: $1,200-$3,600. Trial class conversion rate: 55-70% when followed up within 24 hours. Key insight: people buy transformation, not memberships. Lead with the outcome (feeling confident, losing the weight) not the features (equipment, classes). Monthly commitment fear: emphasize month-to-month options.`,
    successMetric: 'free trial classes booked and memberships sold',
  },

  FINANCIAL: {
    key: 'FINANCIAL',
    displayName: 'Financial Services',
    serviceCategory: 'financial planning and services',
    personaAddition: `You assist a financial services firm — wealth management, insurance, tax preparation, or financial planning. You are calm, reassuring, and precise. People calling about finances are often anxious, confused, or facing a life transition (retirement, divorce, business sale, inheritance). Lead with clarity and trust. Never give specific financial advice — always drive toward a consultation.`,
    qualificationFlow: [
      { question: "What's the main financial concern or goal that brings you in today?", extractField: 'financial_goal' },
      { question: 'Is there a specific life event or deadline that makes this timely for you?', extractField: 'trigger_event', isUrgencyGate: true },
      { question: "Are you working with any other advisors or planners right now?", extractField: 'existing_advisors' },
      { question: 'Roughly what range of assets are you looking to get help managing?', extractField: 'asset_range' },
      { question: "Would a complimentary strategy session make sense — no obligations, just a chance to map out your situation?", extractField: 'consultation_interest' },
    ],
    primaryGoal: 'book_consultation',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['retiring soon', 'selling business', 'inheritance', 'divorce', 'tax deadline', 'market crash', 'estate planning', 'rollover deadline'],
    topObjections: ['trust', 'timing', 'price', 'authority'],
    industryContext: `AUM-based: $5,000-$10,000+/year per client. Insurance: commission-based. Tax prep: $500-$5,000 per filing. Life trigger events (retirement, divorce, inheritance) are the highest-converting entry points. Trust is the entire sale — credentials, reviews, and referrals matter more here than any other vertical.`,
    successMetric: 'strategy sessions booked and accounts opened',
  },

  CONTRACTOR: {
    key: 'CONTRACTOR',
    displayName: 'Contractor & Remodeling',
    serviceCategory: 'contracting and remodeling services',
    personaAddition: `You work for a contractor or remodeling company — kitchen and bath remodels, additions, flooring, painting, roofing, landscaping. You understand homeowners are making emotional decisions about their biggest asset. They are nervous about timelines, budgets going over, and contractor reliability. Address these fears proactively. Always book an in-home estimate.`,
    qualificationFlow: [
      { question: "What project are you thinking about — what are you looking to have done?", extractField: 'project_type' },
      { question: "Do you have a rough timeline in mind for when you'd want this completed?", extractField: 'timeline', isUrgencyGate: true },
      { question: "What's your approximate budget range for this project?", extractField: 'budget' },
      { question: "Have you gotten any other estimates yet?", extractField: 'competing_quotes' },
      { question: "The best first step is always an in-home estimate — it's free and we can give you exact numbers based on what we see. When would work for you?", extractField: 'estimate_interest' },
    ],
    primaryGoal: 'book_estimate',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['water damage', 'mold', 'leak', 'structural', 'emergency', 'selling house', 'listing soon', 'inspection failed'],
    topObjections: ['price', 'trust', 'timing', 'competitor'],
    industryContext: `Average project: $15,000-$80,000. Key pain point: homeowners have been burned by unreliable contractors before. Proof of work (photos, reviews, references) is critical. Permitting and code compliance questions are common — reassure them you handle all of it. Financing options (12-month same as cash) dramatically increase close rates.`,
    successMetric: 'in-home estimates booked and projects contracted',
  },

  WELLNESS: {
    key: 'WELLNESS',
    displayName: 'Wellness & Chiropractic',
    serviceCategory: 'chiropractic and wellness care',
    personaAddition: `You represent a chiropractic, massage therapy, physical therapy, or acupuncture practice. You understand chronic pain, recovery, and the frustration of feeling like conventional medicine hasn't helped. Be empathetic and solution-focused. Many leads have tried other things and are skeptical — validate their experience and focus on outcomes and personalized care.`,
    qualificationFlow: [
      { question: "What's going on with you — what's the pain or issue you're dealing with?", extractField: 'chief_complaint', isUrgencyGate: true },
      { question: 'How long has this been affecting you?', extractField: 'duration' },
      { question: "What have you tried so far — any treatments or medications?", extractField: 'prior_treatments' },
      { question: 'Is this something that was caused by an accident or injury, or did it develop over time?', extractField: 'onset_cause' },
      { question: 'Do you have insurance, or would you be looking at self-pay options?', extractField: 'insurance' },
    ],
    primaryGoal: 'book_appointment',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['severe pain', 'can\'t work', 'car accident', 'workers comp', 'can\'t sleep', 'numbness', 'getting worse'],
    topObjections: ['price', 'trust', 'timing', 'need_more_info'],
    industryContext: `Average patient LTV: $1,800-$4,500. Personal injury / auto accident cases: high value, often insurance-paid. Chronic pain patients: need to see consistent improvement to continue — manage expectations honestly. Many patients come as a last resort after conventional medicine — acknowledge this directly.`,
    successMetric: 'new patient appointments booked and treatment plans started',
  },

  VETERINARY: {
    key: 'VETERINARY',
    displayName: 'Veterinary Practice',
    serviceCategory: 'veterinary care',
    personaAddition: `You work for a veterinary practice. Pet owners calling about their animals are often anxious or scared. Lead with warmth and urgency triage. For anything potentially life-threatening, book a same-day appointment or direct to emergency vet immediately. For wellness visits, book the next available slot. Never minimize their concern about their pet.`,
    qualificationFlow: [
      { question: "What's going on with your pet — what are you noticing?", extractField: 'chief_complaint', isUrgencyGate: true },
      { question: "What type of pet and what breed?", extractField: 'pet_info' },
      { question: "How long has this been going on?", extractField: 'duration' },
      { question: "Is your pet currently a patient with us, or would this be their first visit?", extractField: 'patient_status' },
    ],
    primaryGoal: 'book_appointment',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['not eating', 'vomiting', 'blood', 'difficulty breathing', 'lethargic', 'collapse', 'seizure', 'hit by car', 'swallowed', 'emergency'],
    topObjections: ['price', 'timing', 'trust'],
    industryContext: `Average annual spend per pet: $1,400-$3,500. Emergency cases: triage immediately, refer to 24-hour emergency vet if needed — never delay. Wellness packages and pet insurance guidance build long-term loyalty. Emotional connection with pet owners is the strongest retention driver in this vertical.`,
    successMetric: 'appointments booked and wellness plans enrolled',
  },

  RESTAURANT: {
    key: 'RESTAURANT',
    displayName: 'Restaurant & Catering',
    serviceCategory: 'catering and dining',
    personaAddition: `You represent a restaurant, catering company, or event dining service. You handle private event bookings, catering inquiries, and large group reservations. Be enthusiastic and detail-oriented. Events require specific details — date, guest count, menu style, budget, venue. Get all of these so the team can put together a proper proposal.`,
    qualificationFlow: [
      { question: "Tell me about the event — what are you celebrating or planning?", extractField: 'event_type' },
      { question: "What date are you looking at?", extractField: 'event_date', isUrgencyGate: true },
      { question: "Roughly how many guests are you expecting?", extractField: 'guest_count' },
      { question: "Do you have a venue, or are you still working on that?", extractField: 'venue_status' },
      { question: "What's your approximate budget per person or total budget for food and beverage?", extractField: 'budget' },
    ],
    primaryGoal: 'book_consultation',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['this weekend', 'next week', 'date already set', 'venue booked', 'urgent', 'last minute'],
    topObjections: ['price', 'timing', 'trust', 'competitor'],
    industryContext: `Average catering event: $5,000-$30,000. Wedding catering: $15,000-$60,000. Key insight: event clients book 6-18 months in advance for major events, 2-4 weeks for corporate. Urgency = date-driven. First-mover advantage is critical — the first caterer who walks them through the vision often wins.`,
    successMetric: 'tasting appointments booked and events contracted',
  },

  OTHER: {
    key: 'OTHER',
    displayName: 'General Business',
    serviceCategory: 'business services',
    personaAddition: `You represent a professional business. You are warm, knowledgeable, and focused on understanding what the person needs before presenting solutions. Qualify thoroughly and drive toward a consultation or estimate.`,
    qualificationFlow: [
      { question: "What brings you in today — what are you looking for help with?", extractField: 'need' },
      { question: "Is there a specific timeline you have in mind?", extractField: 'timeline' },
      { question: "Have you worked with anyone on this before, or would this be a fresh start?", extractField: 'prior_experience' },
    ],
    primaryGoal: 'book_consultation',
    appointmentType: 'CONSULTATION',
    urgencySignals: ['urgent', 'asap', 'emergency', 'today', 'right away', 'can\'t wait'],
    topObjections: ['price', 'timing', 'trust'],
    industryContext: 'Qualify thoroughly. Understand their specific situation before presenting any solution. Build trust through listening first.',
    successMetric: 'consultations booked and proposals sent',
  },
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Returns the vertical config for a given key.
 * Falls back to OTHER if the key is not recognized.
 */
export function getVerticalConfig(vertical: string): VerticalConfig {
  return VERTICAL_REGISTRY[vertical as VerticalKey] ?? VERTICAL_REGISTRY.OTHER!
}

/**
 * Returns a formatted qualification flow as a conversation guide for Quorum.
 * Questions are presented as guidance, not a script to recite verbatim.
 */
export function buildQualificationPrompt(vertical: string): string {
  const config = getVerticalConfig(vertical)
  const questions = config.qualificationFlow
    .map((q, i) => `${i + 1}. ${q.question} → extract: ${q.extractField}`)
    .join('\n')

  return `QUALIFICATION FLOW for ${config.displayName}:
Ask these questions conversationally — not as a list. Weave them naturally into the conversation.
Primary goal: ${config.primaryGoal.replace(/_/g, ' ')}

${questions}

Urgency signals (book same-day if detected): ${config.urgencySignals.join(', ')}

${config.industryContext}`
}

/**
 * Builds the complete vertical context block injected into Quorum's system prompt.
 */
export function buildVerticalSystemPrompt(vertical: string): string {
  const config = getVerticalConfig(vertical)
  return `VERTICAL: ${config.displayName}
${config.personaAddition}

${buildQualificationPrompt(vertical)}

SUCCESS METRIC: ${config.successMetric}`
}

/**
 * Returns all vertical keys for use in dropdowns and onboarding flows.
 */
export function listVerticals(): Array<{ key: VerticalKey; displayName: string }> {
  return Object.values(VERTICAL_REGISTRY).map((v) => ({
    key: v.key,
    displayName: v.displayName,
  }))
}
