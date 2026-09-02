/**
 * Authentication Middleware
 * Simple JWT-based auth for API endpoints
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

// SECURITY: Fail startup if JWT_SECRET not provided or too weak
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

// SECURITY: Enforce minimum secret length (32 characters)
if (JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET must be at least 32 characters long');
  console.error('   Generate a strong secret: openssl rand -base64 32');
  process.exit(1);
}

// SECURITY: Warn about weak secrets in development
if (process.env.NODE_ENV === 'development' && JWT_SECRET === 'development-secret-change-in-production') {
  console.warn('⚠️  WARNING: Using default JWT_SECRET in development');
  console.warn('   This is insecure! Generate a strong secret for production.');
}
const JWT_EXPIRY = '7d';

export interface AuthRequest extends Request {
  userId?: string;
}

/**
 * Generate JWT token for user
 */
export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET!, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET!);
    if (typeof decoded === 'object' && decoded !== null && 'userId' in decoded) {
      return { userId: (decoded as any).userId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Auth middleware - protects routes
 */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // For Electron app, check if request is from localhost
  const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.hostname === 'localhost';
  
  // ELECTRON MODE: Allow localhost without auth (Electron app is trusted)
  if (isLocalhost) {
    req.userId = 'electron-user';
    return next();
  }
  
  // For external requests, require JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required' 
    });
  }
  
  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid or expired token' 
    });
  }
  
  req.userId = payload.userId;
  next();
}

/**
 * Optional auth - doesn't block if no token
 */
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
    }
  }
  
  next();
}
