import type { Express } from "express";
import type { Server } from "http";
import { chatWithAI } from "./ai-analyzer";
import { authMiddleware } from "./auth";

// Simple rate limiting middleware
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: any, res: any, next: any) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    const record = rateLimitMap.get(ip);
    
    if (!record || now > record.resetTime) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    if (record.count >= maxRequests) {
      return res.status(429).json({ 
        success: false, 
        error: 'Too many requests. Please try again later.' 
      });
    }
    
    record.count++;
    next();
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // AI Chat endpoint - stateless, orchestrator manages conversation
  // Rate limit: 20 requests per minute
  // Auth: Required (but localhost/Electron is auto-trusted)
  app.post("/api/ai/chat", authMiddleware, rateLimit(20, 60000), async (req, res) => {
    try {
      const { messages, scanContext, systemPrompt, mode } = req.body;
      
      // Get AI response (stateless - orchestrator manages history)
      const response = await chatWithAI(messages, scanContext, systemPrompt, mode);
      
      res.json({ success: true, response });
    } catch (error: any) {
      // SECURITY: Don't expose internal error details
      console.error('AI chat request failed:', error?.message || 'unknown provider error');
      res.status(500).json({ 
        success: false, 
        error: 'An error occurred while processing your request. Please try again.' 
      });
    }
  });

  return httpServer;
}
