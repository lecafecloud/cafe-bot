import winston from 'winston';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logsDir = join(__dirname, '..', '..', 'logs');
if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
}

const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
        if (stack) {
            return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
        }
        return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
);

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        new winston.transports.File({
            filename: join(logsDir, 'error.log'),
            level: 'error'
        }),
        new winston.transports.File({
            filename: join(logsDir, 'combined.log')
        }),
        new winston.transports.Console({
            format: consoleFormat
        })
    ]
});

export default logger;