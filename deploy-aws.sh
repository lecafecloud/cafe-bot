#!/bin/bash

# EC2 User Data Script for Amazon Linux 2023
# Add this to EC2 instance during launch

# Update system
sudo yum update -y

# Install Node.js 20
curl -sL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs git

# Install PM2 globally
sudo npm install -g pm2

# Clone your repository
cd /home/ec2-user
git clone https://github.com/YOUR_USERNAME/cafe-bot.git
cd cafe-bot

# Install dependencies
npm install --production

# Create .env file (you'll need to add your tokens)
cat > .env << 'EOF'
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id
NODE_ENV=production
EOF

# Start bot with PM2
pm2 start src/index.js --name cafe-bot
pm2 save
pm2 startup systemd -u ec2-user --hp /home/ec2-user

echo "Bot deployed! Edit .env file with your actual tokens"