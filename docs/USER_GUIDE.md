# Help to use: Commute Agent

**Website:** https://agentic-commute-planner.cdas2020kapu.workers.dev  ·  Created by **CHANDAN DAS**

The site plans your commute **the night before** and **re-checks it in the morning** using live traffic, BART, Caltrain, ACE and weather data. It tells you when to leave and how to go.

**Required** = the site won't plan without it. **Optional** = it improves the plan.

---

## Step 1 · Sign in (optional, recommended)
Click **Sign in** (top right), enter your email, and open the link you receive.
- **You get:** your settings saved on any device, plus **automatic** 9 PM plans and morning alerts.
- **Without sign-in:** everything still works, but it's saved only in this browser and you press the buttons yourself.

## Step 2 · Your commute
| Field | Required? | What to enter |
|---|---|---|
| Start address | **Required** | Where you leave from, e.g. *Mountain House Pkwy, Mountain House, CA* |
| Destination address | **Required** | Where you're going, e.g. *Great America Pkwy, Santa Clara, CA* |
| Arrive by | **Required** | e.g. *9:00 AM* |
| Arrival | **Required** (preset) | **Hard deadline** = must be on time · **Flexible** = OK to arrive a bit later to avoid traffic |
| Earliest / Latest I'd leave | **Required** | Your departure window, e.g. *7:00–8:00 AM* (earliest must be before latest) |
| Workdays | Optional | The days you commute (preset Mon–Fri) |
| Drive the whole way | Optional | Turn on to compare driving; add your main freeway and parking cost if you know them |

## Step 3 · Your stations
Turn on **at least one** way to travel: Drive, BART, Caltrain or ACE. For each train you turn on:

| Field | Required? | Notes |
|---|---|---|
| Board at / Get off at | **Required** | Pick from the list; the two must be different |
| ACE train times | **Required for ACE** | Morning times at your station, e.g. *06:15, 07:20* (see acerail.com) |
| Drive to station (min) | Recommended | Your usual drive to the station |
| Ride (min) | Auto-filled | Change it if you know better |
| Walk / shuttle to destination (min) | Recommended | From the last station to your door |

## Step 4 · Alerts (optional)
Open **Alerts & memory**:
- **Alert if plan shifts by:** how many minutes of change should trigger an alert (preset 10).
- **Alert webhook:** to get alerts on your phone, install the **ntfy** app, subscribe to a private topic and paste `https://ntfy.sh/<your-topic>`.

## Step 5 · Get your plan
- **Save & plan tomorrow:** the night-before plan.
- **Save & re-plan now:** uses live conditions this morning and shows what changed.
- *Pretend it's …* (top of page): try a morning re-plan at any time of day.

## What you get
- ✅ **Best way to go:** leave time, arrival time, chance of being late and cost.
- 🔁 **Alternatives:** e.g. drive vs. Dublin BART vs. ACE vs. waiting until traffic eases.
- 🤖 **Why:** the AI agent shows which data it checked and how it decided.
- 🟢 **Live data status:** green = live, amber = sample data, red = source unavailable.
- 🔔 **Alerts:** e.g. *"I-580 is backing up. Leave 15 min early, or take ACE."*
- 🧠 **Learns you:** press **I took this** and future plans lean toward the modes you actually use.

## Tips
- Addresses not found? Add the city and "CA".
- A plan takes about 10 seconds while the AI agent checks the data.
- This is a planning aid, not a safety system. Always check conditions yourself.

---
© 2026 CHANDAN DAS. All rights reserved.
