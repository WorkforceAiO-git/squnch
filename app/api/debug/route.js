import { NextResponse } from 'next/server'
import { MongoClient } from 'mongodb'

export async function GET() {
  try {
    // Test MongoDB connection
    const client = new MongoClient(process.env.MONGO_URL)
    await client.connect()
    const db = client.db(process.env.DB_NAME)
    
    // Test a simple operation
    const result = await db.admin().ping()
    await client.close()
    
    return NextResponse.json({ 
      message: "Debug API Working",
      mongodb: "Connected successfully",
      env: {
        MONGO_URL: process.env.MONGO_URL ? "Set" : "Not set",
        DB_NAME: process.env.DB_NAME ? "Set" : "Not set"
      }
    })
  } catch (error) {
    return NextResponse.json({ 
      message: "Debug API Error",
      error: error.message 
    }, { status: 500 })
  }
}