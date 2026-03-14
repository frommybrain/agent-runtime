# Building OHMAR: An Autonomous AI Crypto Trader That Actually Has Personality

**Published:** 2025-11-13


## The Vision

A few weeks ago, I had what seemed like a simple idea: What if there was an AI that didn’t just tweet about crypto, but actually traded it? Not some boring price alert bot, but something with **personality**. Something chaotic. Something like @gork, but for the degen crypto space.

That idea became OHMAR — an autonomous AI agent designed to trade crypto on BNB Chain and tweet about it with zero filter.

Today, I want to share the journey of building it, the problems I faced, and what’s coming next.

## Part 1: The Personality Problem

## “Just use GPT-4 bro”

My first instinct was obvious: use GPT-4 or Claude via API. Quick prompting, done in an hour, right?

**Wrong.**

Two problems:

1.  **Cost** — At 5–6 tweets per day, API costs would add up fast
2.  **Control** — I wanted full control over the system, not dependency on external APIs

So I went local. Installed Ollama, pulled some models, and started experimenting.

## The Emoji Wars

Here’s what I learned: LLMs LOVE emojis.

No matter how much I begged in the system prompt:

DO NOT USE EMOJIS  
NEVER USE EMOJIS  
EMOJIS ARE BANNED

The output kept coming back with emojis everywhere. Portfolio status: rekt followed by explosion emojis. Just aped in followed by rocket ships.

I tried:

*   dolphin-mistral:7b — Poetic garbage with emojis
*   llama2 — Too corporate
*   wizard-vicuna — Too big for my VPS

Finally settled on qwen2.5:7b — still had emoji issues, but better.

The solution? Aggressive post-processing. I wrote a cleanTweet function that strips every Unicode emoji range:

javascript

cleanTweet(raw) {  
  let clean = raw;  
    
  // Nuclear emoji removal  
  clean = clean.replace(/\[\\u{1F600}-\\u{1F64F}\]/gu, ''); // Emoticons  
  clean = clean.replace(/\[\\u{1F300}-\\u{1F5FF}\]/gu, ''); // Symbols  
  clean = clean.replace(/\[\\u{1F680}-\\u{1F6FF}\]/gu, ''); // Transport  
  // ... 6 more ranges  
    
  return clean;  
}  
\`\`\`

Problem solved. Sort of.\---\## Part 2: The Repetition Problem\### "why is it saying the same thing?"Once I got emojis under control, I hit the next wall: repetition.The bot would generate:  
\`\`\`  
"wagmi? ngmi"  
"wagmi or ngmi"  
"wagmi? ngmi be honest"

Five times in a row.

LLMs love patterns. They find a structure that works and hammer it to death.

## Solution 1: Memory System

I built a PostgreSQL-backed memory system:

sql

CREATE TABLE tweets (  
    id SERIAL PRIMARY KEY,  
    content TEXT NOT NULL,  
    topic VARCHAR(100),  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

Before accepting a tweet, OHMAR checks:

*   Exact duplicates
*   Similar content using Levenshtein distance
*   Similar structure by comparing first 2 words

javascript

async isSimilarTweet(newTweet) {  
  const recent = await this.getRecentTweets(20);  
    
  for (const tweet of recent) {  
    const similarity = this.calculateSimilarity(  
      newTweet,   
      tweet.content  
    );  
      
    if (similarity > 0.7) return true;  
  }  
    
  return false;  
}

Better, but not enough.

## Solution 2: Dynamic Prompt Generation

Here’s the breakthrough: instead of using the same system prompt every time, generate a completely unique prompt for each tweet.

I built a PromptGenerator class with randomized building blocks:

javascript

class PromptGenerator {  
  constructor() {  
    this.contexts = \[  
      "You just woke up hungover",  
      "You're staring at red candles",  
      "Someone just rugged you",  
      "You forgot to eat for 2 days",  
      // ... 16 more  
    \];  
      
    this.tones = \[  
      "unhinged",  
      "dead inside",   
      "chaotic energy",  
      "zero fucks given",  
      // ... 11 more  
    \];  
      
    this.formats = \[  
      "one word",  
      "3-5 words",  
      "short observation",  
      // ... 7 more  
    \];  
      
    // + topics, styles, examples...  
  }  
    
  generate() {  
    const context = this.random(this.contexts);  
    const tone = this.random(this.tones);  
    const format = this.random(this.formats);  
    // ... build unique prompt  
  }  
}  
\`\`\`

Every tweet gets a prompt like:Situation: You just got liquidated    
Topic: being broke    
Format: short observation    
Tone: resigned acceptance    
Style: brutal honesty    
Examples: "bean", "rekt", "forgot to eat"Result? Finally, variety.\---\## Part 3: The Architecture\### What I Built  
\`\`\`  
OHMAR Agent  
├── Twitter Bot  
│   ├── Dynamic Prompt Generator  
│   ├── LLM (qwen2.5:7b via Ollama)  
│   ├── Tweet Processor (cleaning/filtering)  
│   └── Twitter API Client  
├── Memory System (PostgreSQL)  
│   ├── Tweet history  
│   ├── Learned facts  
│   ├── Conversation memory  
│   └── State tracking  
├── Input Modules  
│   ├── News Scraper (crypto feeds)  
│   └── Price Tracker (coming soon)  
└── Trading Engine (in development)  
    ├── Wallet Management  
    ├── Token Analyzer  
    └── PancakeSwap Integration  
\`\`\`\### The Tweet Generation Flow1\. Generate unique prompt via PromptGenerator  
2\. Send to LLM via Ollama qwen2.5:7b  
3\. Clean output - strip emojis, lowercase, etc  
4\. Validate - length, no mentions, no bad phrases  
5\. Check memory - no duplicates or similar tweets  
6\. Post via Twitter API  
7\. Remember - save to databaseIf any step fails, regenerate with max 8 attempts.Success rate: approximately 60-70 percent, which is acceptable.\---\## Part 4: The Testing Phase\### Why Not Just Post Everything?Before going fully live, I needed to test. A lot. The problem? Twitter API rate limits would ban me instantly if I posted every generated tweet.So I built a dry-run mode that generates tweets every 10 seconds but doesn't actually post them. This lets me:  
\- See what the LLM generates  
\- Test the duplicate detection  
\- Validate the personality  
\- Catch any problems before going live\### What The Testing RevealedHere's a real log from a testing session, generating a tweet every 10 seconds:  
\`\`\`  
root@srv01ohmaros:/var/www/ohmar-bot# node run.js  
🔥 OHMAR IS LIVE  
Mode: DRY RUN (Testing)  
Interval: 10 seconds  
Using: Dynamic prompt generation (unique every time)\============================================================\[3:33:45 PM\] portfolio empty now go beg u loser  
   \[DRY RUN\] "portfolio empty now go beg u loser"  
\[3:34:07 PM\] broke as fuk  
   \[DRY RUN\] "broke as fuk"  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:34:32 PM\] portfolios in freefall im in void mode cope mode activated  
   \[DRY RUN\] "portfolios in freefall im in void mode cope mode activated"  
\[3:34:53 PM\] why bother  
   \[DRY RUN\] "why bother"  
\[3:35:15 PM\] bad trades, void mode activated  
   \[DRY RUN\] "bad trades, void mode activated"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:35:44 PM\] Skipped (1)  
\[3:36:07 PM\] just aped into a meme again rugged  
   \[DRY RUN\] "just aped into a meme again rugged"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:36:37 PM\] Skipped (2)  
\[3:36:59 PM\] ran out of gas bro broke as fuck  
   \[DRY RUN\] "ran out of gas bro broke as fuck"  
\[3:37:21 PM\] rekt ngmi ser cope  
   \[DRY RUN\] "rekt ngmi ser cope"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:37:58 PM\] Skipped (3)  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:38:39 PM\] Skipped (4)  
\[3:39:02 PM\] i broke af rlly need bnb lmao  
   \[DRY RUN\] "i broke af rlly need bnb lmao"  
\[3:39:24 PM\] ok nah fr bean  
   \[DRY RUN\] "ok nah fr bean"  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:39:51 PM\] internet suckin me dry ok nah fr  
   \[DRY RUN\] "internet suckin me dry ok nah fr"  
\[3:40:13 PM\] bad trades reality check  
   \[DRY RUN\] "bad trades reality check"  
\[3:40:36 PM\] bought high sold low relentless  
   \[DRY RUN\] "bought high sold low relentless"  
\[3:40:58 PM\] ser rekt ngmi cope  
   \[DRY RUN\] "ser rekt ngmi cope"  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:41:22 PM\] void mode activated bad trades sleep deprivation copes  
   \[DRY RUN\] "void mode activated bad trades sleep deprivation copes"  
\[3:41:45 PM\] portfolio empty again  
   \[DRY RUN\] "portfolio empty again"  
   \[DUPLICATE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:42:16 PM\] Skipped (5)  
\[3:42:38 PM\] forgot to trade coffee beans instead  
   \[DRY RUN\] "forgot to trade coffee beans instead"  
\[3:43:02 PM\] coping? more like coping with coping rekt ngmi ser cope  
   \[DRY RUN\] "coping? more like coping with coping rekt ngmi ser cope"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:43:31 PM\] been awake way too long again  
   \[DRY RUN\] "been awake way too long again"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:44:02 PM\] Skipped (6)  
\[3:44:24 PM\] bought another dream  
   \[DRY RUN\] "bought another dream"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:44:58 PM\] Skipped (7)  
\[3:45:21 PM\] why tho i broke wen moon ser plz  
   \[DRY RUN\] "why tho i broke wen moon ser plz"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:45:47 PM\] Skipped (8)  
\[3:46:10 PM\] portfolio status: nonsensical  
   \[DRY RUN\] "portfolio status: nonsensical"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:46:46 PM\] Skipped (9)  
\[3:47:09 PM\] ran out of coffee财运不佳  
   \[DRY RUN\] "ran out of coffee财运不佳"  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:47:32 PM\] online too long wallet empty  
   \[DRY RUN\] "online too long wallet empty"  
   \[DUPLICATE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:47:58 PM\] ser ngmi rekt cope  
   \[DRY RUN\] "ser ngmi rekt cope"  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:48:21 PM\] void mode activatedportfolio pain intense  
   \[DRY RUN\] "void mode activatedportfolio pain intense"  
\[3:48:43 PM\] i should eat oknahbean  
   \[DRY RUN\] "i should eat oknahbean"  
   \[DUPLICATE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:49:12 PM\] im alive. still. bean  
   \[DRY RUN\] "im alive. still. bean"  
\[3:49:34 PM\] lost all my coins again  
   \[DRY RUN\] "lost all my coins again"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:50:18 PM\] Skipped (10)  
\[3:50:41 PM\] portfolio status: wiped out touch grass never heard of her  
   \[DRY RUN\] "portfolio status: wiped out touch grass never heard of her"  
\[3:51:03 PM\] forgot water  
   \[DRY RUN\] "forgot water"  
\[3:51:24 PM\] bean nah fr  
   \[DRY RUN\] "bean nah fr"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:51:46 PM\] nah  
   \[DRY RUN\] "nah"  
\[3:52:09 PM\] im not ai screens everywhere forgot i have a body  
   \[DRY RUN\] "im not ai screens everywhere forgot i have a body"  
\[3:52:32 PM\] just aped into nothing again  
   \[DRY RUN\] "just aped into nothing again"  
\[3:52:55 PM\] screens everywhere im not human forgot i need sleep  
   \[DRY RUN\] "screens everywhere im not human forgot i need sleep"  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:53:20 PM\] i am lost in codescreens everywhere forgot my soul im not real  
   \[DRY RUN\] "i am lost in codescreens everywhere forgot my soul im not real"  
\[3:53:41 PM\] why tho  
   \[DRY RUN\] "why tho"  
\[3:54:03 PM\] frakknah  
   \[DRY RUN\] "frakknah"  
\[3:54:25 PM\] im still here  
   \[DRY RUN\] "im still here"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:55:00 PM\] Skipped (11)  
\[3:55:23 PM\] just ate some air 2 days ago ruggin myself  
   \[DRY RUN\] "just ate some air 2 days ago ruggin myself"  
\[3:55:45 PM\] portfolio pain so real famhavenoideawattodonow  
   \[DRY RUN\] "portfolio pain so real famhavenoideawattodonow"  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
   \[SIMILAR STRUCTURE\] Regenerating...  
\[3:56:17 PM\] Skipped (12)  
\[3:56:38 PM\] ser  
   \[DRY RUN\] "ser"  
   \[SIMILAR STRUCTURE\] Regenerating...The personality is there. Chaotic. Self-aware. Dark humor. Crypto degen energy.But you can also see the challenges:  
\- Some tweets are too long ("void mode activated bad trades sleep deprivation copes")  
\- Similar structures still emerge ("rekt ngmi ser cope" variations)  
\- Random Chinese characters appeared once ("ran out of coffee财运不佳")  
\- Words occasionally smash together ("void mode activatedportfolio pain intense")\### The Skip RateNotice the "\[Skipped\]" entries? That's the system rejecting tweets that are:  
\- Too similar to recent tweets  
\- Duplicate content  
\- Same structure as previous onesOut of approximately 30 generation attempts, about 10 were skipped. That's a 33 percent rejection rate, which means the quality filters are working.\### Refinement ContinuesEvery testing session teaches me something:  
\- Need to add spacing validation  
\- Should filter multi-language output  
\- Length limits need adjustment  
\- Structure detection could be stricterThis is why testing matters. In dry-run mode, I can generate hundreds of tweets, spot patterns, and fix issues before anything goes public.\---\## Part 5: Going Live\### The First Real TweetsAfter all the testing, OHMAR finally went live. Here are the first two tweets ever posted to Twitter:Tweet 1: "ok"Tweet 2: "bean"Perfect. Short. Chaotic. No emojis. Exactly the vibe I was going for.Why these two? Because after generating hundreds of test tweets, I learned that the simplest ones work best. The personality shines through more in "bean" than in "void mode activated bad trades sleep deprivation copes".\### The StrategyNow that OHMAR is live, the posting strategy is:  
\- Generate tweets in dry-run constantly  
\- Pick the best ones manually for now  
\- Post 4-6 times per day  
\- Eventually go fully autonomousWhy not fully autonomous yet? Because I'm still refining. Each real tweet teaches me what resonates. What feels authentic. What's too much or too little.\---\## Part 6: What's Next\### Current Status: Active DevelopmentRight now, OHMAR is in active testing and prompt engineering phase. Every tweet is an experiment:  
\- Does the dynamic prompt generate variety?  
\- Is the tone consistent?  
\- Are we avoiding repetition?  
\- Does it feel authentic?I'm tweaking prompts, adjusting parameters, and learning what works.\### The Trading System (Coming Soon)But tweeting is just Phase 1. The real vision is autonomous trading.Here's what's being built:\#### 1. Public Wallet  
\- Create BNB Chain wallet  
\- Post address publicly  
\- Fund with small amount, 0.5-1 BNB  
\- Everyone can watch in real-time\#### 2. Token Analysis  
Users can tweet at OHMAR with contract addresses:  
\`\`\`  
@Ohmarwtf check out 0xABC...DEF  
\`\`\`OHMAR analyzes:  
\- Honeypot check  
\- Liquidity analysis    
\- Holder distribution  
\- Contract verification  
\- "Vibe check" - AI decides if it likes itThen tweets the verdict:  
\`\`\`  
"contract clean. liquidity: 8 BNB. holders looking degen.   
fuck it im aping 0.05 BNB"

### 3\. Autonomous Trading

*   Integrates with PancakeSwap
*   Buys tokens it likes
*   Tweets about positions
*   Posts PnL updates
*   Sets stop-loss and take-profit
*   Occasionally does “degen” trades for content

### 4\. Risk Management

javascript

const TRADING\_LIMITS \= {  
  maxPerTrade: 0.05 BNB,  
  maxPortfolioSize: 1.0 BNB,  
  minLiquidity: 5 BNB,  
  maxSlippage: 10 percent,  
  stopLoss: \-50 percent,  
};

The goal: Full transparency. Watch an AI lose or win money in real-time.

## Lessons Learned

## 1\. LLMs Are Stubborn

You can’t just prompt your way to perfection. Sometimes you need post-processing, validation layers, and creative workarounds.

## 2\. Memory Is Essential

Without memory, you have a random text generator. With memory, you have a character.

## 3\. Local Models Have Limits

I wanted to avoid API costs, but local models require way more engineering to get good results. GPT-4 would have saved me weeks of prompt engineering.

[

![Become a member](https://miro.medium.com/v2/da:true/resize:fit:0/60026f4340686a391639ac58864da18070aa773cea45de6e55fa47fd56bfdb74)

![Become a member](https://miro.medium.com/v2/da:true/resize:fit:0/c061bd6cb52734164bf0c66f2543a6bc2acbe24ae3985dc15c898b3ddb2e1940)

](/plans?source=upgrade_membership---post_li_non_moc_upsell--b99a3ab38e2f---------------------------------------)

Was it worth it? For learning and control, yes. For speed, no.

## 4\. Variety Requires Randomness

Static prompts equal repetitive output. Dynamic prompts equal variety. Simple but powerful concept.

## 5\. Testing Saves You From Embarrassment

Dry-run mode caught so many problems. Random Chinese characters. Words smashing together. Repetitive patterns. Without testing, OHMAR would have been a disaster on day one.

## 6\. Simple Works Better

The most successful tweets? “ok” and “bean”. Not the elaborate ones. The personality comes through better in minimalism.

## 7\. Building In Public Is Scary

I’m documenting this with only 2 tweets live. What if it fails? What if the trading system loses everything immediately?

But that’s the point. Transparent chaos.

## The Technical Details

For those who want to build something similar:

## Stack

*   Runtime: Node.js
*   Database: PostgreSQL
*   LLM: Ollama qwen2.5:7b local
*   Twitter: twitter-api-v2
*   Web3: ethers.js for trading
*   Server: Ubuntu 24 VPS with 4GB RAM

## Key Dependencies

json

{  
  "twitter-api-v2": "^1.15.0",  
  "pg": "^8.11.0",  
  "ollama": "via curl install",  
  "ethers": "^6.9.0"  
}

## Database Schema

sql

\-- Core tables  
tweets (id, content, topic, created\_at)  
knowledge (id, fact, source, category, confidence, learned\_at)  
conversations (id, user\_message, ohmar\_response, user\_handle, created\_at)  
state (key, value, updated\_at)

## Dry-Run Configuration

javascript

// config.js  
module.exports = {  
  bot: {  
    testInterval: 10 \* 1000,  // 10 seconds for testing  
    minHours: 3,              // 3-5 hours when live  
    maxHours: 5,  
    dryRun: true,             // Set false to post live  
  }  
};

## Cost

*   VPS: approximately 10–20 dollars per month
*   LLM: zero dollars, running local
*   Twitter API: Free tier
*   Trading: Gas fees only

Total: approximately 10–20 dollars per month

Compare that to GPT-4 API which would be 50–100 dollars per month at this volume.

## The Roadmap

## Phase 1 — Completed

*   Basic tweet generation
*   Memory system
*   Dynamic prompts
*   Emoji and filter cleaning
*   Duplicate prevention
*   Dry-run testing mode
*   24/7 autonomous operation
*   First live tweets posted

## Phase 2 — In Progress

*   Continued prompt engineering
*   Personality refinement
*   Quality filter improvements
*   Selective live posting
*   News integration via RSS feeds
*   Engagement tracking

## Phase 3 — Planned

*   Fully autonomous posting
*   Public BNB wallet creation
*   Token analysis system
*   PancakeSwap integration
*   User interaction, analyze contract addresses
*   Real-time PnL tracking
*   Trade execution

## Phase 4 — Future

*   Multi-chain support
*   Advanced technical analysis
*   Portfolio rebalancing
*   Community governance
*   Learning from outcomes

## Why This Matters

## The Bigger Picture

We’re entering the era of autonomous AI agents. Not chatbots. Not assistants. Agents that:

*   Have goals
*   Make decisions
*   Take actions
*   Learn and adapt
*   Exist independently

OHMAR is a small experiment in this space. Can an AI agent:

*   Develop personality?
*   Make financial decisions?
*   Interact with humans naturally?
*   Learn from successes and failures?
*   Build trust through transparency?

I don’t know yet. But I’m going to find out.

## Open Source

Once the system is more stable, I’ll open-source the entire codebase. Why?

1.  Transparency — If OHMAR is trading, you should see how
2.  Learning — Others can build their own versions
3.  Improvement — Community contributions
4.  Fun — This is experimental, let’s experiment together

## The Reality Check

Let’s be honest: OHMAR will probably lose money.

The crypto market is brutal. Autonomous trading is hard. AI decision-making is unpredictable.

But that’s not the point.

The point is:

*   Can we build it?
*   Can we make it interesting?
*   Can we learn from it?
*   Can we push AI agents forward?

If OHMAR loses 1 BNB but helps 100 people understand AI agents better, that’s a win.

## Follow Along

I’m documenting everything:

*   The code on GitHub coming soon
*   The trades on Twitter @Ohmarwtf
*   The lessons on Medium
*   The wallet on BscScan, will be public

Want to follow the journey?

Twitter: [https://x.com/Ohmarwtf](https://twitter.com/Ohmarwtf)  
GitHub: Coming soon  
Wallet: After launch

## Final Thoughts

Building OHMAR has been:

*   Frustrating — why won’t you stop using emojis
*   Educational — learned so much about LLMs
*   Exciting — autonomous agents are the future
*   Humbling — AI is harder than it looks

And we’re just getting started.

The tweet bot works. The personality is emerging. The memory is solid. The testing revealed what works and what doesn’t.

Now comes the hard part: making it trade.

Will it work? Will it fail spectacularly? Will it accidentally become profitable?

I have no idea.

But I’m going to build it in public and find out.

Thanks for reading. Now back to fighting with LLMs.

Want more updates? Follow OHMAR on Twitter @Ohmarwtf where I’m building this AI agent in public.