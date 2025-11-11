import { PermissionFlagsBits } from 'discord.js';

export function checkPermissions(member, permissions) {
    if (!Array.isArray(permissions)) {
        permissions = [permissions];
    }

    const missingPermissions = [];

    for (const permission of permissions) {
        if (!member.permissions.has(permission)) {
            missingPermissions.push(permission);
        }
    }

    return {
        hasPermissions: missingPermissions.length === 0,
        missing: missingPermissions
    };
}

export function checkBotPermissions(guild, permissions) {
    const botMember = guild.members.me;
    return checkPermissions(botMember, permissions);
}

export function formatPermissions(permissions) {
    const permissionNames = {
        [PermissionFlagsBits.Administrator]: 'Administrator',
        [PermissionFlagsBits.ManageGuild]: 'Manage Server',
        [PermissionFlagsBits.ManageRoles]: 'Manage Roles',
        [PermissionFlagsBits.ManageChannels]: 'Manage Channels',
        [PermissionFlagsBits.KickMembers]: 'Kick Members',
        [PermissionFlagsBits.BanMembers]: 'Ban Members',
        [PermissionFlagsBits.ManageMessages]: 'Manage Messages',
        [PermissionFlagsBits.MentionEveryone]: 'Mention Everyone',
        [PermissionFlagsBits.ManageNicknames]: 'Manage Nicknames',
        [PermissionFlagsBits.ManageWebhooks]: 'Manage Webhooks',
        [PermissionFlagsBits.ViewAuditLog]: 'View Audit Log'
    };

    return permissions.map(perm => permissionNames[perm] || 'Unknown Permission').join(', ');
}

export function isOwner(userId) {
    const owners = process.env.OWNER_IDS?.split(',') || [];
    return owners.includes(userId);
}