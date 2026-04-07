import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';

export function createApp() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const swaggerSpec = swaggerJSDoc({
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'TixFlo API (Phase 1)',
        version: '0.1.0',
      },
    },
    apis: [],
  });

  // Minimal OpenAPI doc so you can manually call endpoints in-browser.
  swaggerSpec.paths = {
    '/health': {
      get: {
        summary: 'Health check',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/v2/orgs': {
      post: {
        summary: 'Create organization',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/v2/events': {
      post: {
        summary: 'Create event',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['organizationId', 'name', 'date', 'location'],
                properties: {
                  organizationId: { type: 'string' },
                  name: { type: 'string' },
                  date: { type: 'string', format: 'date-time' },
                  location: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/v2/ticket-types': {
      post: {
        summary: 'Create ticket type',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['eventId', 'name', 'price', 'quantity'],
                properties: {
                  eventId: { type: 'string' },
                  name: { type: 'string' },
                  price: { type: 'integer', description: 'cents' },
                  quantity: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/v2/orders': {
      post: {
        summary: 'Create order (mints tickets, returns one access token)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['eventId', 'organizationId', 'buyerEmail', 'items'],
                properties: {
                  eventId: { type: 'string' },
                  organizationId: { type: 'string' },
                  buyerEmail: { type: 'string' },
                  buyerPhone: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['ticketTypeId', 'qty'],
                      properties: {
                        ticketTypeId: { type: 'string' },
                        qty: { type: 'integer', minimum: 1, maximum: 20 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/v2/orders/access/{token}': {
      get: {
        summary: 'Get order + tickets by access token',
        parameters: [
          {
            name: 'token',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/v2/validate-ticket': {
      post: {
        summary: 'Validate ticket by qrToken (Phase 1 placeholder)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['qrToken'],
                properties: {
                  qrToken: { type: 'string' },
                  deviceId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
  };

  // Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  // Back-compat (older link)
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  const env = {
    TOKEN_PEPPER: process.env.TOKEN_PEPPER || 'dev-pepper-change-me',
  };

  function base64url(buf: Buffer) {
    return buf
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function hashOrderToken(token: string) {
    return crypto.createHash('sha256').update(token).update(env.TOKEN_PEPPER).digest('hex');
  }

  function newOrderAccessToken() {
    return base64url(crypto.randomBytes(32));
  }

  function newQrToken() {
    return base64url(crypto.randomBytes(32));
  }

  const createOrgSchema = z.object({ name: z.string().min(1) });
  app.post('/v2/orgs', async (req, res) => {
    const input = createOrgSchema.parse(req.body);
    const org = await prisma.organization.create({ data: { name: input.name } });
    res.status(201).json(org);
  });

  const createEventSchema = z.object({
    organizationId: z.string().min(1),
    name: z.string().min(1),
    date: z.string().datetime(),
    location: z.string().min(1),
  });
  app.post('/v2/events', async (req, res) => {
    const input = createEventSchema.parse(req.body);
    const event = await prisma.event.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        date: new Date(input.date),
        location: input.location,
        status: 'draft',
      },
    });
    res.status(201).json(event);
  });

  const createTicketTypeSchema = z.object({
    eventId: z.string().min(1),
    name: z.string().min(1),
    price: z.number().int().nonnegative(),
    quantity: z.number().int().positive(),
  });
  app.post('/v2/ticket-types', async (req, res) => {
    const input = createTicketTypeSchema.parse(req.body);
    const tt = await prisma.ticketType.create({
      data: {
        eventId: input.eventId,
        name: input.name,
        price: input.price,
        quantity: input.quantity,
      },
    });
    res.status(201).json(tt);
  });

  const createOrderSchema = z.object({
    eventId: z.string().min(1),
    organizationId: z.string().min(1),
    buyerEmail: z.string().email(),
    buyerPhone: z.string().min(5).optional(),
    items: z
      .array(
        z.object({
          ticketTypeId: z.string().min(1),
          qty: z.number().int().positive().max(20),
        })
      )
      .min(1),
  });

  app.post('/v2/orders', async (req, res) => {
    const input = createOrderSchema.parse(req.body);

    const ticketTypes = await prisma.ticketType.findMany({
      where: { id: { in: input.items.map((i) => i.ticketTypeId) }, eventId: input.eventId },
    });
    const ttById = new Map(ticketTypes.map((t) => [t.id, t]));

    let totalAmount = 0;
    const ticketsToCreate: { ticketTypeId: string; ticketLabel: string; qrToken: string }[] = [];

    for (const item of input.items) {
      const tt = ttById.get(item.ticketTypeId);
      if (!tt) return res.status(400).json({ error: `Invalid ticketTypeId: ${item.ticketTypeId}` });

      totalAmount += tt.price * item.qty;
      for (let n = 1; n <= item.qty; n++) {
        ticketsToCreate.push({
          ticketTypeId: tt.id,
          ticketLabel: `${tt.name} ${n}`,
          qrToken: newQrToken(),
        });
      }
    }

    const accessToken = newOrderAccessToken();
    const accessTokenHash = hashOrderToken(accessToken);

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          eventId: input.eventId,
          organizationId: input.organizationId,
          buyerEmail: input.buyerEmail,
          buyerPhone: input.buyerPhone,
          totalAmount,
          accessTokenHash,
          tickets: {
            create: ticketsToCreate.map((t) => ({
              eventId: input.eventId,
              ticketTypeId: t.ticketTypeId,
              status: 'unused',
              qrToken: t.qrToken,
              ticketLabel: t.ticketLabel,
            })),
          },
        },
        include: { tickets: true },
      });
      return created;
    });

    res.status(201).json({
      orderId: order.id,
      accessToken,
      orderLink: `/orders/access/${accessToken}`,
      totalAmount: order.totalAmount,
      tickets: order.tickets.map((t) => ({ id: t.id, ticketLabel: t.ticketLabel, status: t.status, qrToken: t.qrToken })),
    });
  });

  app.get('/v2/orders/access/:token', async (req, res) => {
    const token = req.params.token;
    const tokenHash = hashOrderToken(token);

    const order = await prisma.order.findUnique({
      where: { accessTokenHash: tokenHash },
      include: {
        event: true,
        tickets: { include: { ticketType: true } },
      },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({
      orderId: order.id,
      buyerEmail: order.buyerEmail,
      buyerPhone: order.buyerPhone,
      event: {
        id: order.event.id,
        name: order.event.name,
        date: order.event.date,
        location: order.event.location,
      },
      totalAmount: order.totalAmount,
      ticketCount: order.tickets.length,
      tickets: order.tickets.map((t) => ({
        id: t.id,
        ticketLabel: t.ticketLabel,
        ticketTypeName: t.ticketType.name,
        status: t.status,
        qrToken: t.qrToken,
      })),
    });
  });

  const validateSchema = z.object({
    qrToken: z.string().min(10),
    deviceId: z.string().min(1).optional(),
  });
  app.post('/v2/validate-ticket', async (req, res) => {
    const input = validateSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      // Atomic "first scan wins": one statement flips unused->used.
      // If no rows are updated, the ticket is either invalid (no qrToken)
      // or already used (duplicate).
      const updated = await tx.ticket.updateMany({
        where: { qrToken: input.qrToken, status: 'unused' },
        data: { status: 'used' },
      });

      if (updated.count === 1) {
        const t = await tx.ticket.findUnique({ where: { qrToken: input.qrToken } });
        // Should always exist here, but guard anyway.
        if (!t) return { status: 'invalid' as const };

        await tx.scan.create({
          data: { ticketId: t.id, status: 'valid', deviceId: input.deviceId },
        });
        return { status: 'valid' as const, ticketId: t.id };
      }

      const existing = await tx.ticket.findUnique({ where: { qrToken: input.qrToken } });
      if (!existing) {
        return { status: 'invalid' as const };
      }

      await tx.scan.create({
        data: { ticketId: existing.id, status: 'duplicate', deviceId: input.deviceId },
      });
      return { status: 'duplicate' as const, ticketId: existing.id };
    });

    res.json(result);
  });

  return { app, prisma, pool };
}
