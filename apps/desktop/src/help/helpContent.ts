/**
 * In-app help content.
 *
 * Stored as data rather than JSX for the same reason legal/documents.ts is: the
 * copy is long, versioned, and wants to be read and reviewed as prose instead of
 * hunted for inside a component. A renderer consumes it, so adding a feature
 * later is a new entry here and nothing else.
 *
 * Rules for writing an entry, learned from the tour copy ("plain English,
 * humanized; do not 'improve' it"):
 *   - Explain the RULE, then the reason. A player who does not know why boost
 *     costs 750 g$ will think the economy is broken.
 *   - Use the words the UI uses. The code says "Conviction Boost" and the
 *     player must see that same word, not "boost your vote".
 *   - Say what a dead end looks like. The most useful line in any of these is
 *     usually the one saying which button unblocks you.
 *   - No marketing. No "we're excited to".
 */

export interface HelpSection {
  heading: string
  body?: string
  /** Rendered as a list. */
  bullets?: string[]
  /** Emphasised on its own, for the one rule that is easy to get wrong. */
  callout?: string
}

export interface HelpTopic {
  id: string
  title: string
  /**
   * Short label for the tab strip. Separate from `title` because the strip has
   * twelve tabs and does not have room for full titles — but it is declared
   * HERE rather than in the component so the two cannot drift apart, which is
   * how a tab reading "Watch" came to sit under a heading reading "Watch
   * Parties".
   */
  tabLabel: string
  /** One line under the tab label in the contents list. */
  blurb: string
  sections: HelpSection[]
}

export const HELP_TOPICS: HelpTopic[] = [
  // ---------------------------------------------------------------- card duels
  {
    id: 'duels',
    title: 'Card Duels',
    tabLabel: 'Duels',
    blurb: 'The 5-round arena: decks, decisions, rarity and payouts.',
    sections: [
      {
        heading: 'What a duel is',
        body:
          'A duel is five rounds. Each round both players pick one card from their deck at the same time, look at what the other picked, and then decide whether to keep it. You win more rounds than your opponent over the five, and the score at the end decides the payout. Nobody can see the other person cards before choosing.',
        bullets: [
          'Every phase is timed: picking a card, the reveal, and the decision all have their own clock.',
          'All five rounds always play out, even if one side is already ahead.',
          'Timing out is not fatal. An unanswered decision counts as a Reject, which costs you points but does not end the match.',
        ],
      },
      {
        heading: 'You need a deck of 5 first',
        body:
          'Queueing requires exactly five cards in your active deck. This is the single most common reason a player cannot get into a duel.',
        bullets: [
          'Build or change a deck in the Deck Builder, then press Set as Active.',
          'You need at least 5 cards in your collection before any of this is possible.',
          'Starting players get 5 free cards, so you can duel immediately. If your collection is empty, that grant may not have completed yet.',
        ],
        callout:
          'Stuck at the queue? The button reads "Build Deck (n/5)" and tells you how many you are short. That number is the whole problem.',
      },
      {
        heading: 'The three decisions',
        body: 'On your turn after the reveal you choose one of three. Each moves the cards permanent score, which is what rarity is computed from.',
        bullets: [
          'Like — +10 points. The ordinary case, and the only one that is free.',
          'Reject — 5 points. The score drops but never below zero, so rejecting something worthless costs you nothing real.',
          'Conviction Boost — +25 points and 4x what a Like pays, for 250 g$ multiplied by your card rarity rank. It is the strongest single move in the game and you get one per match.',
        ],
        callout:
          'A Boost costs g$, so you cannot spam it. Spending it on a card you were going to Like anyway is a waste; spending it on a match-winner is the point.',
      },
      {
        heading: 'Rarity',
        body:
          'A card score between 0 and 5000+ decides its rarity, shown as a coloured frame. It is not cosmetic: rarity feeds directly back into the duel economy.',
        bullets: [
          'Common 0-99 (rank 1)',
          'Copper 100-499 (rank 2)',
          'Silver 500-1499 (rank 3)',
          'Gold 1500-4999 (rank 4)',
          'Diamond 5000 and above (rank 5)',
        ],
      },
      {
        heading: 'What you win',
        body:
          'Duel points translate to g$ at a rate set by your card rarity, so a rarer card wins you more money for the same result.',
        bullets: [
          'Win: 50 g$ x your card rank x theirs',
          'Lose: 10 g$ x your card rank (a consolation, not nothing)',
          'Draw: the same as a loss, plus League Points',
          'Conviction Boost costs 250 g$ x your card rank',
        ],
      },
      {
        heading: 'League Points and the ladder',
        body:
          'Every completed duel awards League Points regardless of result, because showing up is worth something: a win is +50, a draw +10, a loss +5. League Points move you along a ladder from Unranked through Friend, Regular, Preferred, Special, Elite, Rare, Ultra, Legendary and Mythic.',
      },
      {
        heading: 'Special Match',
        body:
          'A separate, shorter ladder for a different mood. There are no boosts and no rejects worth arguing about: both players Like or the match ends. Three mutual Likes promote you a tier, and the fourth is the Final. It is the fastest way to climb, and the easiest to lose.',
        bullets: [
          'Tier 1 Acquaintance, 2 Friend, 3 Regular, 4 Preferred, 5 Special, 6 Elite, 7 Rare, 8 Ultra, 9 Legendary, 10 Mythic, 11+ Divine.',
          'Three mutual Likes to promote, the fourth ends the match for +200 points.',
        ],
      },
      {
        heading: 'Where cards come from',
        bullets: [
          'The 5 free starter cards.',
          'Forge your own from a URL, up to 5 tags. The card shows VALUE TBD until it has been voted on enough to have a score.',
          'Lootboxes in the Store, and the Community Market where players list and buy each other cards.',
          'Gifts, which permanently transfer a card to you.',
        ],
      },
      {
        heading: 'Two rules that surprise people',
        bullets: [
          'You cannot play the same card twice in one duel. Running out is possible; the panel will tell you your deck is exhausted.',
          'You cannot play a card your opponent sent you.',
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- the clicker
  {
    id: 'idle',
    title: 'Clicker',
    tabLabel: 'Clicker',
    blurb: 'Babecock Idle: clicking, heat, tags, gallery and prestige.',
    sections: [
      {
        heading: 'The loop',
        body:
          'Click the image to earn points. Every 25th click is a critical hit worth 10x. Clicking fast builds a Heat combo that multiplies your earnings up to 3x, but it decays if you stop. Points buy tags, and tags generate passive income whether you are clicking or not.',
        bullets: [
          'Heat: keep clicking within 2 seconds to stack it, 10 per stack, +0.25 each, capped at 3x.',
          'Passive income: your tags and gallery keep earning while the app is closed.',
          'Offline earnings are capped at 8 hours and paid at 25%.',
        ],
      },
      {
        heading: 'Tags',
        body:
          'Tags are the upgrade currency. Each one you own adds passive income, and rarer tags are worth more than common ones. There is no cap on how many you can hold, only what they cost.',
        bullets: [
          'The market offers up to 24 new tags at a time, drawn from what the images you have been beating actually had.',
          'Each tag level costs 1.15x more than the last, up to level 20.',
          'Combine two tags with "a b" to make an AND pill that only fires when both match.',
        ],
      },
      {
        heading: 'Gallery',
        body:
          'Images you beat can be kept in your gallery. Each one earns passive income scaled by its rarity, and the price of the next slot rises 1.1x every time, so hoarding early is worth more than hoarding late.',
        callout: 'Your gallery is permanent through prestige. Your points, tags and levels are not.',
      },
      {
        heading: 'Prestige (Brainmelt)',
        body:
          'From tier 5 you can Brainmelt: reset your points, tags and levels for Corruption Shards, each of which adds a flat 10% to everything. You keep your gallery, your shards and your achievements, which makes the first few resets fast and the later ones very strong.',
      },
      {
        heading: 'GoonCaps',
        body: 'Permanent multipliers you buy once. They are the reason a second playthrough is faster than the first.',
        bullets: [
          'E-Girl Spit 150 — doubles click power',
          'Braceface 900 — one automatic click per second',
          'Pornmeat 5,000 — doubles passive income',
          'Brain Drain 50,000 — multiplies everything by 10',
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- feed
  {
    id: 'feed',
    title: 'Feed & Tags',
    tabLabel: 'Feed',
    blurb: 'How the image feed picks what to show you.',
    sections: [
      {
        heading: 'How a round works',
        body:
          'Each round builds one search from two of your tags, skipping any query used in the last eight rounds so you keep seeing new things. Images from a failed source are never shown as a gap: the game falls back to an offline placeholder and says so rather than pretending the feed is empty.',
      },
      {
        heading: 'Only legal images',
        body:
          'Every image and every tag passes a safety filter before it reaches you, on this device. It is a hard block on illegal content and it cannot be turned off or edited from the app.',
        bullets: [
          'The hard block is fixed and covers child sexual abuse material, bestiality, necrophilia and non-consent.',
          'Categories that are legal but not for everyone, such as feet or a school uniform, are OFF by default and you can add them yourself if you want them.',
          'The block is enforced locally, so images are never filtered on a server that could keep a copy.',
        ],
        callout:
          'If a whole category is missing that you expected, check your own excludes in Settings before assuming a source is broken.',
      },
      {
        heading: 'Sources',
        body:
          'Images come from public booru APIs, fetched read-only. There is no upload of anything you do, no telemetry, and no account required to browse.',
      },
    ],
  },

  // ---------------------------------------------------------------- chat
  {
    id: 'chat',
    title: 'Chat',
    tabLabel: 'Chat',
    blurb: 'Lobby, groups, direct messages and sealed rooms.',
    sections: [
      {
        heading: 'The four kinds',
        bullets: [
          'Lobby — public, everyone, and the only one that expires.',
          'Groups — private, invite-only, you choose the members.',
          'Direct messages — one person, end to end encrypted.',
          'Sealed rooms — a group where the message key rotates, for anything you would not want a later member to read.',
        ],
      },
      {
        heading: 'Reading old messages',
        body:
          'Group, DM and room history is permanent and is never swept. A day separator marks where each calendar day starts, and says how long ago that was, so a message from last week cannot be mistaken for one from a minute ago.',
        callout:
          'The lobby is the exception: it is a live channel and its history is capped at 12 hours.',
      },
      {
        heading: 'Who is who',
        body:
          'Names are shown from the account itself. If someone has not set a display name they appear as Unknown User rather than being given someone else\'s name, so you can always tell an unnamed account from a different person.',
      },
    ],
  },

  // ---------------------------------------------------------------- watch
  {
    id: 'watch',
    title: 'Watch Parties',
    tabLabel: 'Watch',
    blurb: 'Synchronised video rooms and who controls them.',
    sections: [
      {
        heading: 'The idea',
        body:
          'A watch room plays one video at a time for everyone in it, in sync. The host controls playback; everyone else follows. Joining late snaps you to what is currently playing rather than making you scrub for it.',
        bullets: [
          'Only the host can load or queue videos.',
          'Rooms can be hidden from the public list. The invite link still works.',
          'Volume is remembered per room, per device.',
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- domination
  {
    id: 'domination',
    title: 'Domination',
    tabLabel: 'Domination',
    blurb: 'Opt-in pranks between friends, and the consent model.',
    sections: [
      {
        heading: 'What it is',
        body:
          'Light pranks you can play on a consenting friend: change their wallpaper, blur their screen, send a message, pop a video. Every one costs g$ and every one requires them to have agreed in advance.',
        bullets: [
          'Consent is per-effect. You approve the specific effects you are willing to receive, and can withdraw at any time.',
          'Withdrawing consent is immediate and there is no charge.',
          'Prices scale with intrusiveness, from a wallpaper change to the camera.',
        ],
        callout:
          'Nothing happens without consent on both sides. If an effect is not in your approved list, it cannot be sent to you.',
      },
    ],
  },

  // ---------------------------------------------------------------- economy
  {
    id: 'economy',
    title: 'Money',
    tabLabel: 'Money',
    blurb: 'The four currencies and what each one is for.',
    sections: [
      {
        heading: 'g$ — the wallet',
        body:
          'The spendable balance. Earned from duels, spent on Store items, Conviction Boosts, GoonCaps and domination effects. This is real value and it is what a card cash-out converts to.',
        callout: 'Cashing a card out is permanent and removes it from your collection.',
      },
      {
        heading: 'Card points (PTS)',
        body:
          'The permanent score on an individual card. Like, Reject and Conviction Boost move it, and it decides rarity. Because it is permanent, a card you invested in keeps its value even when you are not playing with it.',
      },
      {
        heading: 'Reputation',
        body: 'All-time, earned when other players Like or Boost the cards you made. It is the closest thing to a creator score.',
      },
      {
        heading: 'Score',
        body: 'Like reputation, but it resets at midnight UTC. The Rankings board sorts by one or the other, so check which you are looking at before you conclude you have done badly.',
      },
    ],
  },
]

export const HELP_TOPIC_IDS = HELP_TOPICS.map((t) => t.id)
