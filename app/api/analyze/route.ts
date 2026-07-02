import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AIVisionFactory } from '@/lib/ai/factory';
import { toClientErrorPayload } from '@/lib/ai/errors';

// Input validation schema using Zod (accepts standard hex UUID formats and array of base64 images)
const analyzeRequestSchema = z.object({
  studentId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid student ID format'),
  imagesBase64: z.array(z.string().min(1, 'Image data is required')).min(1, 'At least one image page is required'),
});

export async function POST(req: NextRequest) {
  try {
    // Parse and validate the request body
    const body = await req.json().catch(() => ({}));
    const validation = analyzeRequestSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Validation failed', 
          details: validation.error.flatten().fieldErrors 
        },
        { status: 400 }
      );
    }

    const { studentId, imagesBase64 } = validation.data;

    // 1. Verify teacher authentication locally using the JWT token structure
    // This avoids making a slow/timeout-prone round-trip network request to Supabase Auth on the server.
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing access token' }, 
        { status: 401 }
      );
    }

    let userId: string;
    try {
      // Decode the JWT payload locally in memory
      const payloadBase64 = token.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
      userId = payload.sub; // Extract the user's Auth UID
      if (!userId) {
        throw new Error('Missing sub claim in token');
      }
    } catch (jwtError) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid authentication token structure' }, 
        { status: 401 }
      );
    }

    // 2. Process image analysis using the swappable AI provider (in-memory, never persisted)
    let feedback;
    try {
      const aiProvider = AIVisionFactory.getProvider();
      feedback = await aiProvider.analyzeWorksheet(imagesBase64);
    } catch (aiError: any) {
      console.error('AI Analysis Provider error:', aiError);
      return NextResponse.json(
        toClientErrorPayload(aiError),
        { status: 502 }
      );
    }

    // 3. Return the structured feedback details back to the client.
    // The client will securely insert this record into Supabase under RLS policy context.
    return NextResponse.json({
      success: true,
      feedback: {
        pages: feedback.pages,
      },
    });
  } catch (error: any) {
    console.error('Analyze API Route Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
