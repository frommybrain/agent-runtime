# Building OHMAR Part 3: From “Prompt Tricks” to a Real
Autonomous System

**Published:** 2026-01-04

Autonomous System


## Or: The moment I stopped chasing one good prompt and started building a bot with memory, schedules, and a live dashboard.

## Quick recap

In Part 1 and Part 2, I got OHMAR tweeting with a real personality using brute force filtering, dynamic prompts, and a vanity wallet. The character finally sounded human. The tweets stopped being “void mode activated” clones.

The bot could post.

What it could not do was act like a real agent.

So I rewired the entire system around two ideas:

1.  Personality needs structure and friction, not just a prompt
2.  If OHMAR is going to trade one day, it needs memory, scheduling, and observability now

This is the progress since then.

## The new architecture

_(real bot, not just a prompt loop)_

I rebuilt OHMAR into a modular Python system with explicit components instead of a single “generate → post” loop.

## Current project structure (high level)

/ohmarwtf-bot  
  agents.py            \# multi-agent voice system  
  orchestrator.py      \# agent pipeline + time-of-day behavior  
  content\_generator.py \# single entry point for tweet generation  
  ohmar\_memory.py      \# SQLite + embeddings + RAG  
  ohmar\_scheduler.py   \# unified scheduler for posts/replies/quotes/learning  
  tweet\_responder.py   \# quote/mention response generator (memory-aware)  
  mention\_responder.py \# mention polling + reply logic  
  engagement\_tracker.py\# performance checks → top tweet learning  
  twitter\_poster.py    \# post/reply wrapper  
  x\_api\_client.py      \# retries, timeouts, bearer fallback  
  dashboard/           \# FastAPI dashboard + WebSocket log stream  
  systemd/             \# service config for 24/7 uptime

This is no longer a toy prompt script. It is an actual agent runtime.

## Progress 1: A multi agent personality system

Instead of one prompt, OHMAR now has internal voices with different roles:

*   **Mouth**  
    Raw tweet generation
*   **Observer**  
    Veto or approve output to prevent total garbage
*   **Editor**  
    Strips polish and forces the “real” vibe
*   **Agitator**  
    Optional edge booster  
    Currently disabled due to safety filters

There is also time of day weighting. Mornings are quieter. Late nights are more fragmented.

The result is that tweets feel less LLM clean and more like a burned out human typing impulsively.

## Progress 2: Memory went from basic dedupe to real RAG

The original system only blocked repeated phrases.

Now OHMAR has a full memory system:

*   SQLite database for tweets, conversations, users, and learned Discord tweets
*   Embeddings using `nomic-embed-text` via Ollama
*   RAG retrieval for similar tweets and conversations
*   Top tweet learning based on engagement scores
*   Context injection for replies so OHMAR remembers past interactions

When OHMAR replies now, it has real context:

*   What did this user say last time
*   What did I say that got likes
*   What is trending in the Discord stream

This is the difference between a generator and a character.

## Progress 3: Unified scheduler

_(real autonomy, not just looping)_

Instead of sleeping random minutes, OHMAR now runs a unified scheduler that handles:

*   Original posts every N hours
*   Mention checks every 15 minutes
*   Quote tweets every hour
*   Engagement checks every 30 minutes
*   Discord learning every cycle

The scheduler is stateful.

Files like `scheduler_state.json`, `responded_mentions.json`, and `bot_state.json` prevent spamming and duplicate actions.

There is also fast mode and single cycle mode for testing.

This is the backbone of autonomy.

## Progress 4: Discord ingestion and live trend awareness

OHMAR now watches TweetShift channels in Discord and does two things:

1.  Learns from the tweets by storing them in memory with embeddings
2.  Generates quote tweets in its own voice

This means OHMAR is no longer shouting into the void. It reacts to live crypto content and builds topic awareness.

[

![Become a member](https://miro.medium.com/v2/da:true/resize:fit:0/60026f4340686a391639ac58864da18070aa773cea45de6e55fa47fd56bfdb74)

![Become a member](https://miro.medium.com/v2/da:true/resize:fit:0/c061bd6cb52734164bf0c66f2543a6bc2acbe24ae3985dc15c898b3ddb2e1940)

](/plans?source=upgrade_membership---post_li_non_moc_upsell--37f9b9729f69---------------------------------------)

This also makes the eventual trading system more realistic. The bot already has market chatter as input.

## Progress 5: Engagement feedback loop

Tweets are no longer just posted. They are scored.

The engagement tracker pulls public metrics and calculates weighted scores.

Top performers are stored as style examples, and the response system uses them as prompts for better future outputs.

This is simple, but it is the first real step toward a feedback driven agent.

## Progress 6: Dashboard and observability

If I am going to let a bot run 24 7, I need to see what it is doing.

So I built a FastAPI dashboard with:

*   Live status
*   Uptime and posting stats
*   Recent tweets
*   Memory stats
*   Log streaming via WebSocket

This makes OHMAR feel like a service, not a script.

## Progress 7: Ops hardening

The X API client now includes:

*   Retries with backoff
*   Request timeouts
*   Bearer token fallback for read only calls

There is also a systemd unit to keep the scheduler running continuously.

This matters because real bots die from boring infrastructure problems, not model problems.

## Progress 8: Identity upgrades

In Part 2 I generated a vanity BNB wallet.

Since then I also added a Solana vanity generator, because OHMAR’s persona is now explicitly bullish on SOL and bearish on BNB.

This seems small, but it matters. The wallet itself is part of the character.

## What is still missing

_(the real hard part)_

The trading engine is not live yet.

There is no PancakeSwap integration and no on chain execution.

But the scaffolding is finally there:

*   Memory system
*   Quote and mention responsiveness
*   Trend ingestion
*   Engagement feedback
*   Scheduler
*   Dashboard

These are the pieces you need before letting an agent trade real money.

## So what changed since Part 2

Short answer: OHMAR stopped being a prompt with filters and became a real system.

Long answer: everything above.

The biggest shift was not personality. It was infrastructure.

Most of the work went into boring things like memory, scheduling, logging, and ops. That is what keeps an autonomous agent alive long enough to actually learn.

## What is next

Now that the runtime is solid, the next milestones are clear:

1.  Connect the trading engine
2.  Fund a public wallet again
3.  Ship real trade execution
4.  Start learning from wins and losses

The personality is real now. The system is real now. Trading is the last big leap.