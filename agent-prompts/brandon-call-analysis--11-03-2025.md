# Brandon Agent Call Analysis
**Date:** November 3, 2025
**Analysis Period:** October 30-31, 2025
**Transcripts Analyzed:** 6 calls
**Current Prompt Version:** brandon--10-31-2025.md

---

## Executive Summary

Analysis of 6 real call transcripts reveals systematic issues with the Brandon agent that are affecting call success rate and clinic satisfaction. **Only 1-2 out of 6 calls (16-33%) were clearly successful.** The most critical issue is excessive waiting/non-responsiveness (100% of calls), followed by talking too fast when sharing critical information (50% of calls).

### Success Rate
- **T1:** Unclear - Policy required formal fax/email request
- **T2:** Failed/Unclear - Record scope confusion, speed complaints
- **T3:** Failed - No-show not handled properly, continued asking questions
- **T4:** Failed - Patient not found due to speed issues, name confusion
- **T5:** Partial Success - Records already sent, but handling was awkward
- **T6:** Success ✅ - But required 3 repeats of email, caused date confusion

**Overall: ~16-33% clear success rate**

---

## Critical Issues by Frequency

### 🚨 Priority 1: Excessive Waiting/Non-Responsiveness
**Frequency:** 6/6 calls (100%)
**Severity:** CRITICAL

**Problem:** Brandon waits after almost every human response instead of continuing the conversation. This makes him seem unresponsive, confused, or like he's not listening.

**Examples:**
- "Okay." → waits (should continue)
- "Go ahead." → waits (this is an INVITATION to speak!)
- "Mhmm." → waits (acknowledgment, should continue)
- Direct questions → waits (should answer immediately)
- "Hello? Are you there?" → Brandon was silent at call start (T6)

**Impact:**
- Creates awkward silences
- Frustrates clinic staff
- Makes Brandon seem robotic or malfunctioning
- Lengthens call duration unnecessarily

---

### 🚨 Priority 2: Talking Too Fast (Critical Information)
**Frequency:** 3/6 calls (50%)
**Severity:** CRITICAL

**Problem:** When sharing critical information (names, emails, dates, phone numbers), Brandon speaks too quickly for clinic staff to write down accurately.

**Direct Complaints from Clinics:**
- T2: "Okay. A little bit slower, sir, because he just went too fast for me too fast right now."
- T4: "I need you to slow down. Why what?"
- T4: "you're you're you're speaking way too fast. All I have is y o n g."
- T4: "I'm having a hard time because you're speaking so fast."
- T6: "I'm sorry. You're gonna gonna go on too fast. I do apologize. I wanna keep asking you to say it again."

**What's Being Rushed:**
- Employee name spelling
- Date of birth
- Email address (medical@nmshealth.com)
- Fax number
- Phonetic alphabet (N-M-S)

**Impact:**
- Multiple repeat requests (T6: email repeated 3 times)
- Incomplete information captured (T4: only got "Y O N G")
- Patient lookup failures (T4: couldn't find patient)
- Clinic frustration and annoyance

---

### 🚨 Priority 3: Call End Not Recognized
**Frequency:** 4/6 calls (67%)
**Severity:** HIGH

**Problem:** Brandon doesn't recognize when the human is ending the call, leading to awkward continued waiting.

**Examples:**
- "Have a good day." → waits
- "Bye bye." → waits
- "You too." → waits (after Brandon said goodbye)
- "Alright. Bye bye." → waits

**Impact:**
- Awkward call endings
- Clinic staff has to wait for Brandon to hang up
- Unprofessional impression

---

### 🚨 Priority 4: Exam Type/Procedures Unclear
**Frequency:** 4/6 calls (67%)
**Severity:** HIGH

**Problem:** Brandon doesn't clearly communicate what type of exam/procedures the records are for, leading to confusion.

**Examples:**
- T2: "So what what do we need to need the results from the NMS, like the I don't know. I don't know what to say." (confused about scope)
- T2: "Is it is it for the Coast Guard? Physical?" (asking for clarification)
- T3: "Was he coming in for a DOT?" (clinic needs to know type)
- T5: "she was here for a physical. Right?" (guessing)
- T6: "And what records did you need sent over?" (still unclear after explanation)

**Impact:**
- Clinic can't locate records efficiently
- Multiple clarification questions needed
- Slows down call flow

---

### ⚠️ Priority 5: Date/Number Format Issues
**Frequency:** 2/6 calls (33%)
**Severity:** HIGH (causes critical errors)

**Problem:** Brandon says dates as numbers, which causes ambiguity and confusion.

**Examples:**

**DOB Confusion (T5, T6):**
- T5: "05/03/1991" → Clinic asks: "Or did you say 08/03?" (May 3 vs August 3?)
- T6: Brandon says "05/24/1987" → Human asks to confirm → Brandon repeats exact same thing → Still unclear

**Appointment Date Confusion (T6 - CRITICAL):**
- Brandon: "10/27/2025" (October 27)
- Human heard: "August 27" (8/27)
- **WRONG DATE = WRONG RECORDS**

**Root Cause:**
- "ten-twenty-seven" sounds like "eight-twenty-seven"
- Number formats are inherently ambiguous
- People mishear numbers easily

**Impact:**
- Wrong records pulled
- Failed patient lookups
- Repeated clarifications needed

---

### ⚠️ Priority 6: Missing Patient Identifiers
**Frequency:** 3/6 calls (50%)
**Severity:** MEDIUM

**Problem:** Clinics often need additional identifiers (phone, address, SSN) to locate patients, but Brandon doesn't have this info and doesn't handle the request well.

**Examples:**
- T2: "Do you have the phone number?"
- T3: "What is his address?" + "Do you have social?" + "Phone number?"
- T4: "Do you have a social?"

**Current Issue:** Brandon doesn't have a script for "I don't have that information."

**Impact:**
- Patient lookup failures
- Brandon keeps waiting instead of saying he doesn't have the info
- Clinics get frustrated

---

### ⚠️ Other Issues

**"Already Sent" Scenario (T5):**
- Clinic: "I faxed it yesterday"
- Brandon made them think NMS didn't receive it
- Clinic offered to resend unnecessarily
- **Prompt says to acknowledge and end call, but Brandon didn't follow**

**No-Show Not Handled (T3):**
- Clinic: "But did not show. So we have nothing."
- Brandon should have ended call immediately
- Instead, continued asking verification questions
- **Prompt says to end call, but Brandon didn't follow**

**Name Order Confusion (T4):**
- Asian name "Yong"
- Clinic: "What's the which one is the first name and which is the last name?"
- Brandon didn't clarify first vs last name

**Policy Handling (T1):**
- Clinic: "It has to be requested through a fax or the email"
- Brandon doesn't have script for clinics that require formal written requests
- Should ask for their fax/email instead of giving NMS's

---

## Transcript-by-Transcript Breakdown

### Transcript 1 - Samaritan Occupational (10/31/2025, 1:07 PM)
**Result:** Unclear - Policy issue

**Key Moments:**
- Clinic (Susie): "I can't help you with that over the phone. It has to be requested through a fax or the email."
- Brandon: Tried to give email/fax but didn't adapt to their process
- Multiple "wait" actions after simple acknowledgments

**Issues:**
- Excessive waiting (15+ wait actions)
- No script for "formal request required" policies
- Should have asked for THEIR contact info, not given his

**What Should Have Happened:**
"Oh perfect! What fax number should I send the request to?"

---

### Transcript 2 - Transentral Northgate (10/31/2025, 1:08 PM)
**Result:** Failed/Unclear - Speed and clarity issues

**Key Moments:**
- Rep (Leah): "A little bit slower, sir, because he just went too fast"
- Rep: "So what what do we need... I don't know. I don't know what to say" (confused about what records)
- Rep: "Is it is it for the Coast Guard? Physical?"

**Issues:**
- Speed complaints
- Name spelling too fast (last name "Hung")
- Record scope unclear
- Fax number repeated multiple times
- DOB repeated
- Excessive waiting (20+ actions)

**What Should Have Happened:**
Should have said "It was for their [procedures]" clearly upfront.

---

### Transcript 3 - Central Medical Group (10/30/2025, 12:43 PM)
**Result:** Failed - No-show not handled

**Key Moments:**
- Rep: "He had an appointment Actually, October 24. But did not show. So we have nothing."
- Brandon: Continued asking questions instead of ending call
- Rep had to verify DOB, address, phone multiple times
- Rep: "Hello?" (Brandon went silent)

**Issues:**
- NO-SHOW scenario not recognized
- Should have immediately said "I'll mark as no-show, thanks!" and ended call
- Instead asked for more verification info
- Excessive waiting (30+ actions)
- Silent period where rep had to check if Brandon was there

**Critical Failure:** Wasted clinic's time after they confirmed no-show.

---

### Transcript 4 - Concentra (10/30/2025, 12:34 PM)
**Result:** FAILED - Patient not found

**Key Moments:**
- Rep (Janice): "I need you to slow down. Why what?"
- Rep: "you're you're you're speaking way too fast. All I have is y o n g"
- Rep: "I'm having a hard time because you're speaking so fast that I cannot pull up his name"
- Rep: "I need you to start with the first name and spell it letter by letter"
- 4+ minutes on hold listening to promotional messages ✅ (correctly waited)
- Rep: "Yeah. I don't see that patient in the system"
- Rep: "Because I don't have a name." (couldn't capture the name due to speed)

**Issues:**
- Worst speed issue in all transcripts
- Name confusion (likely Asian name)
- Patient lookup failed because name wasn't captured correctly
- Excessive waiting (35+ actions)
- No recovery strategy when patient not found

**Critical Failure:** Call completely failed due to speed issues preventing basic patient lookup.

---

### Transcript 5 - Patient Person on Town (10/30/2025, 12:33 PM)
**Result:** Partial Success - Records already sent

**Key Moments:**
- Rep (Tim Herman): "Yeah. I I think I handled that one. I just I faxed it yesterday"
- Tim: "I sent it to 2 to two faxes, 60 the (609) 246-3785. And then the the 866434730593"
- Tim: "And then I got a confirmation, but they not did they not get it?"
- Tim: "if if you didn't get it, I'll send it again. That's fine"

**Issues:**
- DOB format confusion: "05/03/1991" vs "08/03" (May vs August?)
- "Already sent" scenario handled incorrectly
- Made Tim think NMS didn't receive the records
- Tim offered to resend unnecessarily
- Excessive waiting (30+ actions)

**What Should Have Happened:**
"Oh perfect! Sounds like you already took care of it. Thanks!"

---

### Transcript 6 - Combined Audio (Full Transcript)
**Result:** SUCCESS ✅ (but with issues)

**Key Moments:**
- OPENING: "Hello? Are you there?" (Brandon was SILENT at call start)
- Brandon: "date of birth is 05/24/1987"
- Human: "05/24/1987?" (confirming)
- Brandon: "Oh, I apologize for that. The correct date of birth is 05/24/1987" (SAME DATE - didn't understand the issue)
- Brandon: "10/27/2025" → Human heard: "August 27" (DATE CONFUSION - wrong month!)
- Human: "I'm sorry. You're gonna gonna go on too fast. I do apologize. I wanna keep asking you to say it again"
- Email repeated 3 times due to speed
- Rep (Andrina): "And what records did you need sent over?" (still unclear after explanation)

**Issues:**
- Silent at call start
- DOB as numbers caused confusion
- Appointment date misheard (October → August)
- Speed complaints, email repeated 3x
- Procedures not mentioned
- Excessive waiting throughout

**Success Factor:**
- Call DID result in records being sent
- Brandon showed good patience ("Of course, no problem")
- Got rep's name successfully
- **Recognized call end this time!** (improvement)

---

## Pattern Analysis

### Issues Present Across Multiple Calls

| Issue | Frequency | Severity | Pattern |
|-------|-----------|----------|---------|
| Excessive waiting/non-responsive | 6/6 (100%) | CRITICAL | Every single call, multiple times per call |
| Call end not recognized | 4/6 (67%) | HIGH | Consistent pattern of not hanging up |
| Exam type/procedures unclear | 4/6 (67%) | HIGH | Clinics keep asking "what records?" |
| Talking too fast (critical info) | 3/6 (50%) | CRITICAL | Direct complaints in 3 calls, severe when happens |
| Missing patient identifiers | 3/6 (50%) | MEDIUM | Clinics need SSN/phone/address |
| Date/number format confusion | 2/6 (33%) | HIGH | Causes wrong date interpretation |
| Already sent not handled | 1/6 (17%) | MEDIUM | Made clinic resend unnecessarily |
| No-show not handled | 1/6 (17%) | MEDIUM | Continued call when should end |
| Name order confusion | 1/6 (17%) | LOW | First/last name clarity |
| Policy handling missing | 1/6 (17%) | MEDIUM | No script for formal request requirements |

### AI Behavior Issues

**The AI is not following the prompt in several key areas:**

1. **Pacing Instructions Ignored:** Prompt clearly states to slow down for critical info, but AI rushes through it 50% of the time
2. **No-Show Instructions Ignored:** Prompt says to end call immediately on no-show (T3), but AI continued
3. **"Already Sent" Instructions Ignored:** Prompt says to acknowledge and end call (T5), but AI made them resend

**This suggests the prompt needs to be:**
- More explicit
- More forceful in language
- Restructured to emphasize critical instructions
- Add negative examples (what NOT to do)

---

## Root Cause Analysis

### Why is the AI waiting too much?

**Hypothesis:**
- The prompt's IVR detection instruction ("stay silent and let IVR detection system work") may be over-applied
- The "don't fill every silence" instruction is being misinterpreted
- AI may be defaulting to "wait" when uncertain about next action
- The conversational flow section doesn't emphasize RESPONDING vs WAITING clearly enough

**Evidence:**
- AI correctly waits during hold music (T4 - 4+ minutes)
- But also waits after direct questions ("Go ahead", "And date of birth?")
- This suggests AI CAN distinguish, but is being too cautious

### Why is the AI talking too fast for critical info?

**Hypothesis:**
- The prompt says "keep responses short and conversational" which may be interpreted as "talk fast"
- The pacing section exists but isn't prominent enough
- No examples of EXACTLY how slowly to speak
- AI may not understand the difference between "conversational speed" and "dictation speed"

**Evidence:**
- Brandon talks at normal speed during general conversation
- But when spelling names, emails, dates - doesn't slow down enough
- Multiple clinics explicitly say "you're going too fast"
- Even after being asked to repeat, doesn't slow down sufficiently (T4, T6)

### Why doesn't the AI recognize call endings?

**Hypothesis:**
- The prompt doesn't explicitly list call-ending phrases
- The "match the energy" instruction may make AI wait to see what human does next
- No clear instruction to use end_call_tool when hearing goodbye phrases

---

## Recommendations by Priority

### CRITICAL - Must Fix Immediately

**1. Rewrite Response Timing Section**
- Make it impossible to miss when to respond vs wait
- Add explicit list of phrases that require immediate response
- Add "DEFAULT TO RESPONDING" rule
- Fix call start silence issue

**2. Restructure Critical Information Sharing**
- Create separate "ULTRA-SLOW MODE" section
- Require month names for all dates (never numbers)
- Require letter-by-letter spelling with pauses
- Add specific timing: "1 second pause between each letter"
- Show examples of too fast vs correct speed

**3. Add Explicit Call End Detection**
- List all call-ending phrases
- Require immediate response + end_call_tool
- No ambiguity

**4. Add Procedures/Exam Type to Opening**
- Change opening script to include "for their [procedures]"
- Add reminder to reference procedures when asked "what records?"

### HIGH PRIORITY - Fix Soon

**5. Add Date Format Rules**
- Mandate month names for all dates
- No number formats allowed
- Show examples of confusion caused by numbers

**6. Add "Already Sent" Handling**
- Clear script for this scenario
- Emphasize: don't make them resend

**7. Fix No-Show Detection**
- Make it clearer to end call immediately
- List phrases that indicate no-show

### MEDIUM PRIORITY

**8. Add Missing Info Script**
- "I don't have that information" responses
- For SSN, phone, address requests

**9. Add Policy Handling**
- Script for clinics requiring formal requests
- Ask for THEIR fax/email

**10. Add Patient Not Found Recovery**
- Script for when clinic can't locate patient
- Get callback info and end gracefully

---

## Key Metrics to Track After Fixes

1. **Wait Actions Per Call** - Should decrease significantly
2. **Speed Complaints** - Should go to 0
3. **Information Repeat Requests** - Should decrease (currently 3x in T6)
4. **Call Success Rate** - Should increase from 16-33% to >80%
5. **Call Duration** - May decrease with less waiting
6. **Clinic Frustration Indicators** - ("Hello?", "Are you there?", "You're going too fast")

---

## Positive Observations

Despite the issues, there are signs Brandon's core personality is working:

1. ✅ **Hold music handling works** - Correctly waited 4+ minutes through promotional messages (T4)
2. ✅ **Polite and professional tone** - "Of course", "No problem at all", "I appreciate your help"
3. ✅ **Shows patience** - Doesn't get flustered when asked to repeat (T6)
4. ✅ **Gets rep names** - Successfully asks for and captures names (T5: Tim Herman, T6: Andrina Cornegay)
5. ✅ **Basic call flow works** - When issues don't occur, the conversation flows naturally

**The foundation is solid. The issues are fixable with prompt improvements.**

---

## Next Steps

1. Update brandon--10-31-2025.md with critical fixes
2. Test with new transcripts to measure improvement
3. Create versioned prompt (brandon--11-XX-2025.md)
4. Monitor metrics on next batch of calls
5. Iterate based on results

---

## Appendix: Quick Reference

### Speed Complaint Quotes
- "A little bit slower, sir, because he just went too fast"
- "I need you to slow down"
- "you're you're you're speaking way too fast"
- "I'm having a hard time because you're speaking so fast"
- "You're gonna gonna go on too fast. I do apologize. I wanna keep asking you to say it again"

### Clinic Confusion Quotes
- "So what what do we need... I don't know. I don't know what to say"
- "Is it is it for the Coast Guard? Physical?"
- "Was he coming in for a DOT?"
- "And what records did you need sent over?"

### Non-Responsiveness Quotes
- "Hello? Are you there?"
- "Hello?" (mid-call)
- "Go ahead." → waits

---

**Analysis Completed by:** AI Assistant
**Date:** November 3, 2025
**Document Version:** 1.0
