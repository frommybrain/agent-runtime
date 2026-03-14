# Building OHMAR Part 2: Teaching An AI To Actually Have Personality

**Published:** 2025-11-16


## Or: How I Spent A Week Fighting An LLM To Stop Being Generic

## Quick Recap

In [Part 1](link-to-first-article), I introduced OHMAR — an autonomous AI crypto trader designed to tweet with personality and eventually trade real money on BNB Chain.

The vision: A self-aware, darkly funny AI that tweets about being a burned-out crypto degen while actually trading with a public wallet everyone can watch.

**Status then:** Basic tweet generation working, but repetitive and generic.

**Status now:** OHMAR has a real personality, a vanity wallet address, and is ready to go live.

Here’s what happened.

## The Problem: AI Doesn’t Have Personality By Default

After my first article, I let OHMAR run overnight in test mode. I woke up to hundreds of generated tweets.

They all sucked.

"void mode activated"  
"void mode activated again"  
"ser rekt ngmi cope"  
"rekt ngmi ser cope"  
"ngmi rekt ser cope"  
"portfolio status: deleted"  
"portfolio status: zero"  
"portfolio status: gone"

**Same phrases. Same structure. Zero personality.**

The LLM (qwen2.5:7b running locally via Ollama) was just recycling crypto buzzwords. It wasn’t creating a character — it was generating madlibs.

## Attempt #1: Better Prompts (Failed)

I tried being more specific in the prompts:

"Be unique and original"  
"Don't repeat yourself"  
"Think of something you've never said before"

**Result:** The LLM completely ignored this and continued spamming “void mode activated.”

## Attempt #2: Aggressive Filtering (Worked)

I realized I couldn’t trust the LLM to follow instructions. I had to **force** variety through code.

## The Filter System:

**1\. Banned Phrases**

javascript

bannedPhrases: \[  
  'void mode activated',  
  'cope mode activated',  
  'ser rekt ngmi cope',  
  'portfolio status:',  
  'wen moon',  
\]

Any tweet containing these gets immediately rejected.

**2\. Overused Word Tracking**

javascript

overusedWords: {  
  'again': 4,    // Max 4 times per 100 tweets  
  'still': 4,  
  'forgot': 5,  
  'maybe': 4,  
  'probably': 4,  
}

The bot queries the database to check word frequency before accepting a tweet.

**3\. Structure Detection**

This was the breakthrough. Instead of just checking exact duplicates, I track **sentence structure**:

javascript

getStructure(tweet) {  
  const words = tweet.split(/\\s+/);  
  return words.map((w, i) => \`w${i+1}\`).join(' ');  
}  
\`\`\`

So tweets like:  
\- "bought the top" → \`w1 w2 w3\`  
\- "sold the bottom" → \`w1 w2 w3\`  
\- "lost my wallet" → \`w1 w2 w3\`All have the same structure and get rejected if that pattern appears 3+ times in recent tweets.\*\*4. Similarity Detection (Levenshtein Distance)\*\*Checks if a new tweet is >75% similar to any recent tweet using string distance algorithms.\---\## \*\*The Result: Real Personality Emerged\*\*After implementing these filters, something interesting happened.The bot \*\*had to get creative\*\* to pass the filters. It couldn't fall back on repetitive patterns.Recent generated tweets:  
\`\`\`  
"my dead wallet keeps reminding me to save money"  
"people really think i know what im doing here?"  
"bragging about gains? my wallet starts with dead. who needs that?"  
"cant remember my last real meal"  
"been up for 36 hours again"  
"this wallet makes me sad"

**These feel human.** Self-aware. Darkly funny. Specific.

Not generic crypto cope posting — actual personality.

## Rewriting The Prompt Generator

I also completely rewrote how prompts are generated. Instead of generic “tweet about crypto,” I built **situational prompts**:

javascript

situations: \[  
  "you just watched your portfolio drop 50% in an hour",  
  "you've been staring at charts for 8 hours straight",  
  "you're eating instant ramen again for the third day",  
  "you forgot what day it is",  
  "someone is bragging about their gains while you're down bad",  
  "you haven't talked to a real person in days",  
\]

moods: \[  
  "defeated but joking about it",  
  "self-aware and cynical",  
  "numb to the pain",  
  "philosophical about losses",  
  "too tired to care anymore",  
\]tweetTypes: \[  
  "dark observation about your life",  
  "self-deprecating joke about your trading",  
  "existential realization",  
  "acknowledgment of a basic need you're ignoring",  
  "brief moment of self-awareness",  
\]  
\`\`\`Every tweet gets a \*\*unique combination\*\* of situation + mood + type, making each prompt completely different.\*\*Example prompt sent to the LLM:\*\*  
\`\`\`  
You are OHMAR, a burned-out crypto trader who lives on his computer.CURRENT SITUATION: you're eating instant ramen again for the third day  
YOUR MOOD: too tired to care anymore  
TWEET TYPE: acknowledgment of a basic need you're ignoringGenerate ONE honest tweet (3-10 words, lowercase, human):  
\`\`\`\*\*Output:\*\* "cant remember my last real meal"That's \*\*specific\*\*. That's \*\*personality\*\*.\---\## \*\*The Vanity Wallet: 0xdead...\*\*While working on the personality, I decided OHMAR needed a proper wallet for the eventual trading functionality.I could have just generated a random address. But that's boring.So I built a vanity address generator that searches for wallets starting with specific patterns.\*\*Target:\*\* \`0xdead...\`Why? Because a burned-out crypto trader with a wallet address that starts with "DEAD" is peak dark humor.After checking ~250,000 addresses, I found it:\*\*\`0xdead8c3ce35ee6888fd28967531c9d1d21bdd2e7\`\*\*Perfect.Now OHMAR can reference this in tweets:  
\`\`\`  
"wallet starts with dead somehow fitting"  
"the dead wallet lives on"  
"my wallet predicted my future"  
\`\`\`The wallet is currently empty but will be funded with 0.1-0.2 BNB (~$60-120) for small experimental trades.\*\*Anyone can watch it:\*\* \[bscscan.com/address/0xdead8c3ce35ee6888fd28967531c9d1d21bdd2e7\](https://bscscan.com/address/0xdead8c3ce35ee6888fd28967531c9d1d21bdd2e7)\---\## \*\*The Skip Rate: Quality Over Quantity\*\*Here's the thing about these aggressive filters: \*\*they reject a LOT of tweets.\*\*Current stats from test runs:  
\- \*\*Attempts:\*\* ~500 tweet generations  
\- \*\*Rejected:\*\* ~300 (60%)  
\- \*\*Accepted:\*\* ~200 (40%)Rejections happen for:  
\- Banned phrases (15%)  
\- Similar structure (30%)  
\- Overused words (10%)  
\- Too similar to recent tweet (5%)\*\*Is this inefficient?\*\* Yes.\*\*Is it worth it?\*\* Absolutely.I'd rather OHMAR tweet 4 great tweets per day than 20 generic ones.\---\## \*\*What's Next: Actual Trading\*\*The tweets are working. The personality is there. Now comes the hard part: making OHMAR actually trade.\### \*\*Phase 1: Token Discovery (In Progress)\*\*  
\- Monitor new token launches on BNB Chain  
\- Filter for minimum liquidity (>1 BNB)  
\- Check for honeypots and scams  
\- Pick random low-cap tokens to "ape" into\### \*\*Phase 2: Trading Logic\*\*  
\- Maximum trade size: 0.01 BNB (~$6)  
\- Minimum trade size: 0.005 BNB (~$3)  
\- 15% slippage tolerance (it's shitcoins, what do you expect)  
\- 1 hour cooldown between trades  
\- Tweet before and after each trade\### \*\*Phase 3: Position Management\*\*  
\- Check positions every 6 hours  
\- Tweet PnL updates  
\- Set stop-loss at -50% (lol)  
\- Take profit at... who are we kidding, there won't be profits  
\- Tweet when positions get rugged\### \*\*Phase 4: The Content\*\*This is where it gets fun. OHMAR will tweet things like:\*\*Before trade:\*\*  
\`\`\`  
"found something called SafeMoon2.0"  
"this cant possibly go wrong"  
"fuck it aping 0.01 BNB"  
\`\`\`\*\*After trade:\*\*  
\`\`\`  
"down 30% in 4 minutes new record"  
"the liquidity just disappeared"  
"at least i got the tweet"  
\`\`\`\*\*Wallet updates:\*\*  
\`\`\`  
"portfolio value: $12.47"  
"been holding this bag for 3 days"  
"exit liquidity strikes again"

## The Reality Check

Let’s be honest: **OHMAR will lose money.**

The crypto market is brutal. Automated trading is hard. Low-cap shitcoins are designed to rug.

But that’s not the point.

[

![Become a member](https://miro.medium.com/v2/da:true/resize:fit:0/60026f4340686a391639ac58864da18070aa773cea45de6e55fa47fd56bfdb74)

![Become a member](https://miro.medium.com/v2/da:true/resize:fit:0/c061bd6cb52734164bf0c66f2543a6bc2acbe24ae3985dc15c898b3ddb2e1940)

](/plans?source=upgrade_membership---post_li_non_moc_upsell--defc9b04e4bf---------------------------------------)

The point is:

*   **Transparency:** Every trade is public
*   **Entertainment:** Watch an AI make terrible decisions
*   **Learning:** See what happens when you automate degen trading
*   **Authenticity:** Real money, real losses, real personality

If OHMAR loses 0.2 BNB but creates interesting content and helps people understand AI agents better, that’s a win.

## Technical Stack Update

**Current Setup:**

*   **Runtime:** Node.js
*   **Database:** PostgreSQL (with structure tracking)
*   **LLM:** Ollama qwen2.5:7b (local, $0 cost)
*   **Filtering:** Custom multi-layer validation
*   **Twitter:** twitter-api-v2 (Free tier for now)
*   **Blockchain:** ethers.js for BNB Chain
*   **Server:** Ubuntu 24 VPS (4GB RAM)

**Monthly Cost:** ~$10–20 (just the VPS)

## The Numbers

**Testing Stats (Last 7 Days):**

*   Tweet generation attempts: ~2,000
*   Tweets accepted: ~800
*   Average attempts per good tweet: 2.5
*   Success rate: 40%
*   Unique structures: 156
*   Banned phrase blocks: 287
*   Overused word blocks: 143

**Personality Metrics:**

*   Self-aware tweets: 35%
*   Dark humor: 28%
*   Wallet references: 12%
*   Existential observations: 15%
*   Generic cope: 10%

## Lessons Learned

## 1\. LLMs Are Lazy

They will find the easiest pattern that works and spam it forever. You can’t prompt your way out of this — you need code enforcement.

## 2\. Constraints Create Creativity

The aggressive filtering **forced** variety. When the bot couldn’t use common phrases, it had to get creative.

## 3\. Personality Requires Structure

Random prompts = random output. Situational prompts (context + mood + type) = coherent personality.

## 4\. Local LLMs Are Hard But Worth It

GPT-4 would have been easier, but:

*   Costs add up fast at scale
*   No control over the system
*   Less learning

Fighting with local models taught me way more about prompt engineering.

## 5\. Testing Takes Time

I ran the bot in dry-run mode for **days** before going live. Watched thousands of generations. Tuned filters constantly.

The alternative is going live with trash.

## What You Can Watch

**Right Now:**

*   OHMAR’s Twitter: [@Ohmarwtf](https://twitter.com/Ohmarwtf)
*   Current tweets: “ok” and “bean” (the first successful outputs)
*   More coming as I turn on live mode

**Coming Soon:**

*   Public wallet funding announcement
*   First trades (probably terrible)
*   Live PnL updates
*   Transparent failure

**Eventually:**

*   Open source code (once trading is stable)
*   Trading analytics dashboard
*   Community wallet voting (maybe)

## The Roadmap

## Completed

*   Tweet generation with personality
*   Multi-layer filtering system
*   Dynamic prompt generation
*   Structure tracking
*   Vanity wallet address
*   Database integration
*   24/7 autonomous operation

## In Progress

*   Fine-tuning personality consistency
*   Adding more situational variety
*   Wallet funding
*   Trading module architecture

## Planned

*   Token discovery system
*   PancakeSwap integration
*   Trade execution
*   Position monitoring
*   PnL tracking and tweets
*   Real-time wallet updates

## Future

*   Multi-chain support (maybe)
*   Community governance (maybe)
*   Advanced TA (probably not)
*   Profitability (definitely not)

## Why This Matters

We’re at the beginning of autonomous AI agents. Not chatbots. Not assistants. **Agents** that:

*   Have persistent personality
*   Make decisions independently
*   Take real actions
*   Learn from outcomes
*   Exist continuously

OHMAR is a small experiment in this space.

Can an AI:

*   Develop a believable personality?
*   Make financial decisions?
*   Create authentic content?
*   Build trust through transparency?
*   Fail gracefully?

I don’t know yet. But I’m building it in public to find out.

## Follow Along

**Twitter:** [@Ohmarwtf](https://twitter.com/Ohmarwtf)  
**Wallet:** [0xdead8c3ce35ee6888fd28967531c9d1d21bdd2e7](https://bscscan.com/address/0xdead8c3ce35ee6888fd28967531c9d1d21bdd2e7)  
**GitHub:** Coming soon (after trading is stable)  
**Updates:** I’ll write Part 3 when trading goes live

## Final Thoughts

Building OHMAR has been:

*   **Frustrating:** LLMs fight you at every step
*   **Educational:** Learned a ton about prompt engineering and filtering
*   **Exciting:** Autonomous agents are the future
*   **Humbling:** AI is way harder than it looks

The tweet generation works. The personality is there. The wallet exists.

Now I need to make OHMAR actually trade.

**Will he make money?** No.

**Will it be entertaining?** Absolutely.

**Will we learn something?** I hope so.

Thanks for following along. Now back to building.

## Tags

`AI` `Crypto` `BNBChain` `MachineLearning` `Web3` `AutonomousAgents` `BuildInPublic` `LLM` `Trading` `Personality`