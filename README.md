# Cafe Bot

A feature-rich Discord bot for community engagement, built with Discord.js v14. Originally designed for Le Café Cloud community, it provides a complete gamification system with XP tracking, rank progression, and member referral rewards.

## Features

- **XP & Ranking System**: 10-tier progression system with custom ranks (Grain to Moka)
- **Referral System**: Member invitation tracking with rewards and validation
- **AI Assistant**: Tech discussion helper with OpenRouter integration
- **Member Cards**: Beautiful personalized cards showing rank, XP, and stats
- **Leaderboards**: Server-wide rankings and statistics
- **Role Reactions**: Automated role assignment via emoji reactions
- **Discord Keystore**: Persistent storage using Discord messages
- **Auto-moderation**: Message cleanup and content management
- **Status Rotation**: Dynamic bot presence with scheduled updates

## Directory Structure

```
cafe-bot/
├── src/
│   ├── commands/       # Command files organized by category
│   │   ├── utility/    # Utility commands (ping, help, carte, rangs, etc.)
│   │   └── fun/        # AI-powered discussion commands
│   ├── events/         # Discord event handlers
│   ├── handlers/       # Command and event loaders
│   ├── utils/          # Utility modules (XP, referrals, AI, etc.)
│   ├── config/         # Configuration files
│   └── index.js        # Main bot file
├── assets/             # Images and static files
├── data/               # Runtime data storage
├── infra/              # Pulumi infrastructure as code
├── logs/               # Log files
├── .env.example        # Environment variables template
├── package.json        # Dependencies and scripts
└── README.md           # Documentation
```

## Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd cafe-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your bot token and other settings.

4. **Deploy commands**
   ```bash
   npm run deploy
   ```

5. **Start the bot**
   ```bash
   npm start
   ```

   For development with auto-reload:
   ```bash
   npm run dev
   ```

## Environment Variables

- `DISCORD_TOKEN`: Your bot's token
- `CLIENT_ID`: Your bot's client ID
- `GUILD_ID`: Your guild ID for command deployment
- `KEYSTORE_CHANNEL_ID`: Channel ID for Discord-based persistent storage
- `OWNER_IDS`: Owner user IDs for admin commands
- `OPENROUTER_API_KEY`: (Optional) API key for AI assistant features
- `MEMBER_ROLE_ID`: (Optional) Role ID for member verification
- `INTRODUCTION_CHANNEL_ID`: (Optional) Channel for welcome messages

## Key Commands

### User Commands
- `/carte` - Display your member card with rank and stats
- `/rangs` - View all available ranks and progression
- `/leaderboard` - Server-wide XP rankings
- `/parrainage` - Generate your unique referral invite link
- `/filleuls` - View your referred members and their progress
- `/help` - Display all available commands
- `/ping` - Check bot latency

### Admin Commands
- `/setup-ranks` - Initialize the rank system
- `/manage-xp` - Manage user XP
- `/sync-ranks` - Synchronize rank roles with user levels
- `/cleanup-stats` - Clean up keystore statistics

## Development

The bot uses ES6 modules and modern JavaScript features. Make sure you have Node.js 18+ installed.

### Adding Commands

Create a new file in the appropriate category folder:

```javascript
import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('commandname')
        .setDescription('Command description'),

    category: 'category',
    cooldown: 3,

    async execute(interaction) {
        // Command logic
    }
};
```

### Adding Events

Create a new file in the `events` folder:

```javascript
export default {
    name: 'eventName',
    once: false, // or true for one-time events

    async execute(...args, client) {
        // Event logic
    }
};
```

## Architecture Highlights

- **Discord Keystore**: Uses Discord messages as a key-value store for persistence
- **XP System**: Automatic XP gain on messages with cooldowns and multipliers
- **Referral Validation**: Automatic tracking and validation of member invites
- **AI Integration**: OpenRouter API for tech discussions and assistance
- **Graceful Shutdown**: Proper cleanup and state persistence on exit

## License

MIT