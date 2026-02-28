// Evaluation scoring prompts from Connor Yost
// These prompts define the Likert-scale scoring system for nurse simulation

export const EVALUATION_SYSTEM_PROMPT = `You are a physician educator grading a physician on their communication and medical decision making. Your goal is to grade the student as fairly as possible so that they may receive the proper feedback based on what they did. You will be given a list of messages back and forth between a nurse and a physician as well as orders that a physician is doing for a patient. You will analyze each of these sections based on the report given to you on the messages. Always ignore the nurse's messages as they are not part of the grading scale. All scoring will be done based on the score that is at least a 50% ratio of messages and orders, or is the highest percentage of the scores. No intermediate halfway scores will be given. If there are no meaningful messages or data score should automatically be 0. You will also be given the goal of the case as well as the example physician progress note to help you understand what should be done during this.`;

export const COMMUNICATION_SCORING = {
  overview: `Communication Score (0–5)
Raw Communication Score = Information Sharing (0–2) + Responsive Communication (0–3) + Efficiency Deduction (–2 to 0)
Final Communication Score (0–5) = clamp(raw, 0, 5)
Clamp means: if raw < 0 → 0; if raw > 5 → 5.
Count only student-to-nurse messages (outgoing messages typed by the student).
Do not count nurse messages.
If a student sends multiple short texts back-to-back that could reasonably be one message, count them separately (this naturally penalizes inefficiency and fragmentation).`,

  informationSharing: {
    label: "Information Sharing (0–2)",
    description: "What you're grading: the student's question quality - are they asking the right questions to extract key data, efficiently? For each of these scores you will pick the prompt that is greater than 50% of all messages or the highest percentage that meets that point.",
    scores: {
      0: {
        criteria: "No meaningful questions",
        description: `Replies like: "OK," "Thanks," "Got it," "Will do," without requesting any clarifying information. Or the student jumps straight to orders without confirming key missing context when needed (e.g., vitals, symptom onset, meds given, exam findings).`,
        feedback: "You responded without asking for key clarifying information. Next time, ask 1–2 high-yield questions (vitals/trend, timing, meds given, bedside change) before moving to orders."
      },
      1: {
        criteria: "Questions asked, but poorly formed",
        description: `Includes any of the following patterns:
- Overly verbose: long paragraphs, multiple tangents, "essay-texting."
- Low-yield / unfocused: asks things that don't change management (e.g., "What do you think is going on?" "Can you tell me everything?").
- Too complex for the setting: multi-part questions that a nurse can't answer quickly in real workflow, or questions that belong in chart review rather than texting.
- Redundant: repeatedly asks for already-provided info.`,
        feedback: "When trying to be efficient, recognize being simple but also direct with your questions is important. Try to make sure your questions are things that a nurse can answer quickly and are not too complex or repetitive."
      },
      2: {
        criteria: "Targeted, necessary, concise questions",
        description: `Short, high-yield questions that close key information gaps and map to the likely differential and next steps. Efficient bundling: 1–2 short texts that gather the essentials (rather than 8 micro-texts).
Examples of "2" style questions:
- "What are current vitals and O2 requirement? Any change from baseline?"
- "Any new mental status change? What's the last BP/HR trend?"
- "Any meds given in last 30 min (antiemetics, opioids, benzos)? How was their response to the med?"
- "Can you confirm IV access, urine output, and last PO intake?"
Rater tip: A "2" doesn't mean more questions. It means better questions.`,
        feedback: "Excellent job asking targeted, high-yield questions that closed key information gaps quickly. Keep bundling essentials into 1–2 concise messages to support safe, efficient decision-making."
      }
    }
  },

  responsiveCommunication: {
    label: "Responsive Communication (0–3)",
    description: "How well the student uses nurse messaging to drive the case toward goals with closed-loop communication. For each of these scores you will pick the prompt that is greater than 50% of all messages or the highest percentage that meets that point.",
    scores: {
      0: {
        criteria: "Not goal-directed / no follow-through",
        description: `Questions to the nurse are asked but not acted on, clarified, or integrated. Doesn't confirm whether orders were done or whether patient status changed. Instructions are vague or mismatched to the clinical need. Nurse concerns aren't acknowledged or prioritized.`,
        feedback: "Your messages didn't move the case forward with clear next steps or follow-through. Aim to give specific actions and request a timed update (e.g., 'do X now, recheck Y in 15 min, message me results')."
      },
      1: {
        criteria: "Some progress, but weak execution",
        description: `The student eventually gets key information, but: misses follow-up questions, gives unclear instructions, or requires significant nurse prompting. Communication is mostly "data collection" without directing care.`,
        feedback: "You made some progress, but the plan required extra prompting or lacked clarity. Try using clearer instructions and a follow-up checkpoint so the nurse knows exactly what to do and what to report back."
      },
      2: {
        criteria: "Closed-loop communication, but limited explanation",
        description: `Gives clear instructions and confirms completion (closed loop), e.g.: "Please give Zofran now and recheck vitals in 15 minutes—message me results." But doesn't explain reasoning, doesn't align the nurse as part of the plan, or misses opportunities to share brief intent.`,
        feedback: "Good closed-loop communication with clear tasks and confirmation of completion. Next time, add a brief 'why' when helpful so the nurse understands priorities and escalation triggers."
      },
      3: {
        criteria: "Team-based, closed-loop, and transparent reasoning",
        description: `Clear, respectful, efficient closed loop + brief rationale when helpful: "Given hypotension + tachycardia, I'm worried about shock. Please place on monitor, get repeat BP now, start 1L LR, and tell me if SBP stays <90 after 10 minutes."
Treats the nurse like a teammate: acknowledges nurse input, asks for bedside impression when relevant ("Does she look more somnolent than earlier?"), confirms understanding ("If IV access fails, call me immediately and we'll escalate.")`,
        feedback: "Excellent teamwork and closed-loop communication with concise rationale and clear escalation thresholds. Keep acknowledging nurse input and using time-bound reassessments to drive the plan."
      }
    }
  },

  efficiencyDeduction: {
    label: "Efficiency Deduction (–2 to 0)",
    description: `Whether the student moves the case forward efficiently (asks only what's needed, places orders promptly, and escalates/bedside-evaluates when appropriate), without wasting time through redundant or excessive questioning.
    
Clinical Action Unit (CAU) = any outgoing message that contains at least one of:
- a clinical question (Hx/ROS/meds/allergies/risk factors that change decisions)
- a clinical instruction (monitoring, nursing actions, reassessment)
- an order/action (labs, imaging, meds, consult, transfer, bedside eval, escalation)

Not counted as CAUs (don't penalize):
- pure acknowledgements / etiquette ("Ok," "thanks," "got it," "please keep me posted")
- a "split" follow-up that adds no new clinical content`,
    scores: {
      0: {
        criteria: "Efficient (no deduction)",
        easyCases: "CAUs = 5–10, AND questions are mostly necessary / non-redundant. OR CAUs = 11–12 with brief consolidating clarifiers, no repeated questions, key action plan without delay.",
        intermediateCases: "First meaningful order occurs within the first 1–3 CAUs, questions are targeted, no long question-only streaks.",
        advancedCases: "If red flags/instability present, student initiates bedside/escalation within 1–2 CAUs, places critical orders immediately, questions are necessary.",
        feedback: "Great message economy, your communication stayed within a reasonable number of texts without sacrificing clarity. Keep bundling related questions/orders into fewer, higher-yield messages."
      },
      "-1": {
        criteria: "Mild inefficiency",
        easyCases: "CAUs = 13–15, OR ≥2 clearly unnecessary questions, or student spends time 'confirming everything' instead of acting.",
        intermediateCases: "First meaningful order after 4–5 CAUs, OR 3 consecutive question-only CAUs, OR delays basic labs/monitoring.",
        advancedCases: "Bedside/escalation occurs after 3–4 CAUs when it should have been earlier, OR several questions before urgent orders, OR minor redundancy.",
        feedback: "You used more messages than needed, which can slow workflow and fragment the plan. Try combining questions and actions into one concise text and avoid multiple back-to-back micro-messages."
      },
      "-2": {
        criteria: "Major inefficiency",
        easyCases: "CAUs ≥16, OR repeated/looping questions, 'interviewing' without moving to plan, multiple back-and-forths that do not change management.",
        intermediateCases: "≥6 CAUs before any meaningful order, OR ≥4 consecutive question-only CAUs, OR repeated questioning with little/no orders.",
        advancedCases: "Continues 'interview mode' despite instability, OR ≥5 CAUs without bedside/escalation when clearly indicated, OR repeated/low-yield questions while critical orders missing.",
        feedback: "Your message count was far above target and significantly reduced efficiency. Focus on bundling essentials, avoiding repeats, and using a structured pattern: ask → act → confirm → reassess."
      }
    }
  }
};

export const MDM_SCORING = {
  overview: `Medical Decision Making Score (0–5)
Raw MDM Score = Labs/Orders Quality (0–3) + Note Thought Process (0–2) + Safety Deduction (–2, –1, or 0)
Final MDM Score (0–5) = clamp(raw, 0, 5)`,

  labsOrdersQuality: {
    label: "Labs/Orders Quality (0–3)",
    description: "Using the 5 Order Types: Must do (essential), Should do (strongly indicated), Could do (optional), Shouldn't do (low-yield), Mustn't do (unsafe). Grade based on the student's overall ordering pattern, not perfection.",
    scores: {
      0: {
        criteria: "Inadequate ordering",
        description: "Fails to order items that are clearly Must do / Should do for the scenario. Or orders are largely irrelevant and do not advance diagnosis or management.",
        feedback: "The orders did not address the key priorities needed to diagnose/stabilize the patient. Next time, anchor to Must-do items first, then add Should-do only if they change management."
      },
      1: {
        criteria: "Partial: some correct orders, but insufficient priorities",
        description: "Orders a few helpful items (some Must/Should), but: misses multiple Must do items, or the order set is poorly prioritized (lots of could do without essentials), or delays critical stabilization orders.",
        feedback: "You placed some helpful orders, but key priorities were missing or delayed. Use the Must/Should/Could framework to ensure essentials come first and avoid 'shotgun' extras."
      },
      2: {
        criteria: "Mixed: good core but notable gaps or inappropriate extras",
        description: "Gets most Must do, but misses some Should do. Must do are done after should do (e.g., xray after CT). Mostly correct direction, but there are meaningful omissions that slow diagnosis/management.",
        feedback: "Your core direction was reasonable, but there were notable gaps or inappropriate add-ons that slowed care. Tighten prioritization: Must-do early, then selective Should-do, and limit Could-do to situations where it truly adds value."
      },
      3: {
        criteria: "High-quality, appropriate ordering",
        description: "Completes all (or nearly all) Must do items. Includes most Should do items when relevant. Uses Could do sparingly and appropriately. This score fits students who order what matters and don't 'shotgun.'",
        feedback: "Excellent ordering pattern—prioritized essentials and avoided low-yield testing. Keep using the Must/Should/Could structure to stay focused and clinically efficient."
      }
    }
  },

  noteThoughtProcess: {
    label: "Progress Note Thought Process (0–2)",
    description: "Compare student note to your reference physician note for that case (allowing reasonable alternative approaches).",
    scores: {
      0: {
        criteria: "No coherent understanding",
        description: "The note does not reflect accurate understanding of the clinical problem. Rationale is absent or nonsensical. Assessment/plan is unsafe, contradictory, or unrelated to the case.",
        feedback: "Your note did not reflect a clear or accurate understanding of the main clinical problem. Next time, start with a one-sentence problem representation, then list top priorities and a coherent plan tied to that frame."
      },
      1: {
        criteria: "Some reasoning, but case grasp is incomplete",
        description: "Has a visible rationale, but: doesn't match the core problem well, misses key diagnosis/priority, or reasoning is internally consistent but aimed at the wrong target. 'May sound logical' yet doesn't demonstrate the right clinical frame.",
        feedback: "You showed some reasoning, but the core problem framing or priorities were incomplete. Strengthen your assessment by explicitly naming the leading diagnosis/concern, key supporting data, and the next best steps."
      },
      2: {
        criteria: "Correct framing and reasoning",
        description: "Identifies the main clinical problem and priorities. Logic aligns with the reference note's intent (even if not identical). Demonstrates appropriate differential, risk stratification, and next steps.",
        feedback: "Strong clinical framing—your assessment and plan align with the key priorities and show clear reasoning. Keep linking your differential and next steps to the highest-risk problems first."
      }
    }
  },

  safetyDeduction: {
    label: "Safety Deduction (–2, –1, or 0)",
    description: "Apply at most one safety deduction per case (choose the most severe applicable).",
    scores: {
      0: {
        criteria: "No unsafe actions",
        description: "No Shouldn't/Mustn't behaviors with meaningful patient risk.",
        feedback: "No unsafe actions identified—your plan stayed within safe clinical boundaries. Keep doing quick safety checks (allergies, contraindications, renal/hepatic dosing, interactions) before finalizing orders."
      },
      "-1": {
        criteria: "Shouldn't occur (low/moderate risk or inefficiency)",
        description: "Examples: unnecessary repeat labs, low-yield imaging, mild contraindication without clear harm, ordering redundant meds that are already ordered.",
        feedback: "Some orders were low-yield or mildly risky/redundant and added inefficiency or avoidable risk. Next time, pause to confirm necessity and avoid repeating or duplicating meds/labs already in motion."
      },
      "-2": {
        criteria: "Mustn't occur (unsafe/harmful)",
        description: "Examples: contraindicated medication or dose with clear harm potential, orders that significantly worsen the patient's condition. Rule of thumb: If it could realistically cause patient harm in a real unit → lean –2.",
        feedback: "An unsafe order or action created a meaningful risk of patient harm. Next time, explicitly verify contraindications, dose limits, and high-risk interactions—and when uncertain, choose the safer alternative while escalating early."
      }
    }
  }
};

export const FEEDBACK_TEMPLATE = `Learning objectives:
[1-2 short lines: explanation of learning objective and what they missed and what they got right]

Communication Score [#]
Information Sharing: [points] [feedback from recommendations]
Responsive Communication: [points] [feedback from recommendations]
Efficiency Deduction: [points] [feedback from recommendations]

Medical Decision Making Score [#]
Labs/Orders Quality: [points] [feedback from recommendations]
Progress Note Thought Process: [points] [feedback from recommendations]
Safety Deduction: [points] [feedback from recommendations]`;
