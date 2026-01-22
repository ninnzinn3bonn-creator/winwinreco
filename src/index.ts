import "reflect-metadata"; // Should be the first import
import * as dotenv from "dotenv";
import express from 'express';
import { AppDataSource } from "./data-source";
import { Server as WebSocketServer } from 'ws';
import { RoomService } from "./services/RoomService";
import { UtteranceService } from "./services/UtteranceService";
import http from 'http';

dotenv.config(); // Load environment variables

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const port = process.env.PORT || 3000;

const roomService = new RoomService();
const utteranceService = new UtteranceService();

// In-memory store for WebSocket clients by room
const rooms = new Map<string, Set<WebSocket>>();

app.use(express.json());

AppDataSource.initialize()
  .then(() => {
    console.log("Data Source has been initialized!");

    app.post('/api/rooms', async (req, res) => {
      const room = await roomService.createRoom();
      res.json(room);
    });

    app.post('/api/rooms/:roomId/join', async (req, res) => {
      const { roomId } = req.params;
      const { userName } = req.body;
      const user = await roomService.joinRoom(roomId, userName);
      if (user) {
        res.json(user);
      } else {
        res.status(404).send('Room not found');
      }
    });

    app.get('/api/rooms/:roomId/log', async (req, res) => {
      const { roomId } = req.params;
      const log = await roomService.getLog(roomId);
      if (log) {
        res.json(log);
      } else {
        res.status(404).send('Room not found');
      }
    });

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const roomId = url.searchParams.get('roomId');
      const userId = url.searchParams.get('userId');

      if (!roomId || !userId) {
        ws.close(1008, 'Room ID and User ID are required');
        return;
      }

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }
      rooms.get(roomId)!.add(ws);

      ws.on('message', async (message) => {
        const text = message.toString();
        const utterance = await utteranceService.createUtterance(roomId, userId, text);
        if (utterance) {
          const messagePayload = JSON.stringify(utterance);
          rooms.get(roomId)?.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(messagePayload);
            }
          });
        }
      });

      ws.on('close', () => {
        if (rooms.has(roomId)) {
          rooms.get(roomId)!.delete(ws);
          if (rooms.get(roomId)!.size === 0) {
            rooms.delete(roomId);
          }
        }
      });
    });

    server.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  })
  .catch((error) => console.error("Error during Data Source initialization:", error));
