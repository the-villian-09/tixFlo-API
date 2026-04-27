import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';

export function createApp() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const parsedUrl = new URL(connectionString);
  console.log('TixFlo DB target', {
    protocol: parsedUrl.protocol,
    host: parsedUrl.hostname,
    port: parsedUrl.port,
    database: parsedUrl.pathname.replace(/^\//, ''),
    username: parsedUrl.username,
  });

  const prisma = new PrismaClient();

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

  const updateOrderDeliverySchema = z.object({
    method: z.enum(['email', 'sms', 'manual']).default('manual'),
  });

  app.post('/v2/orders/:orderId/deliver', async (req, res) => {
    const orderId = req.params.orderId;
    const input = updateOrderDeliverySchema.parse(req.body ?? {});

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const now = new Date();
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        deliveryStatus: 'delivered',
        deliveryMethod: input.method,
        deliveredAt: now,
        lastSentAt: now,
      },
    });

    res.json({
      orderId: updated.id,
      deliveryStatus: updated.deliveryStatus,
      deliveryMethod: updated.deliveryMethod,
      deliveredAt: updated.deliveredAt,
      lastSentAt: updated.lastSentAt,
      resendCount: updated.resendCount,
    });
  });

  app.post('/v2/orders/:orderId/resend', async (req, res) => {
    const orderId = req.params.orderId;
    const input = updateOrderDeliverySchema.parse(req.body ?? {});

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        deliveryStatus: 'resent',
        deliveryMethod: input.method,
        lastSentAt: new Date(),
        resendCount: { increment: 1 },
      },
    });

    res.json({
      orderId: updated.id,
      deliveryStatus: updated.deliveryStatus,
      deliveryMethod: updated.deliveryMethod,
      deliveredAt: updated.deliveredAt,
      lastSentAt: updated.lastSentAt,
      resendCount: updated.resendCount,
    });
  });

  const validateSchema = z.object({
    qrToken: z.string().min(1),
    deviceId: z.string().min(1).optional(),
  });

  app.get('/v2/orders/access/:token', async (req, res) => {
    try {
      const token = req.params.token;
      const tokenHash = hashOrderToken(token);

      const order = await prisma.order.findUnique({
        where: { accessTokenHash: tokenHash },
        include: {
          event: true,
          organization: true,
          tickets: { include: { ticketType: true } },
        },
      });
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const purchasedAt = order.createdAt.toISOString();
      const currency = 'USD';

      res.json({
        order: {
          id: order.id,
          status: 'paid',
          deliveryStatus: order.deliveryStatus,
          deliveryMethod: order.deliveryMethod,
          buyerEmail: order.buyerEmail,
          buyerPhone: order.buyerPhone,
          purchasedAt,
          totalAmount: order.totalAmount,
          currency,
          ticketCount: order.tickets.length,
          deliveredAt: order.deliveredAt,
          lastSentAt: order.lastSentAt,
          resendCount: order.resendCount,
          access: {
            token,
            orderLink: `/orders/access/${token}`,
          },
        },
        organization: {
          id: order.organization.id,
          name: order.organization.name,
        },
        event: {
          id: order.event.id,
          name: order.event.name,
          date: order.event.date,
          location: order.event.location,
        },
        tickets: order.tickets.map((t) => ({
          id: t.id,
          label: t.ticketLabel,
          ticketType: {
            id: t.ticketType.id,
            name: t.ticketType.name,
            price: t.ticketType.price,
          },
          status: t.status,
          qr: {
            token: t.qrToken,
            payload: t.qrToken,
          },
        })),
      });
    } catch (error) {
      console.error('GET /v2/orders/access/:token failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/v2/events/:eventId/checkins', async (req, res) => {
    const eventId = req.params.eventId;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const scans = await prisma.scan.findMany({
      where: { ticket: { eventId } },
      orderBy: { scannedAt: 'desc' },
      include: {
        ticket: {
          include: {
            order: true,
            ticketType: true,
          },
        },
      },
    });

    res.json({
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location,
      },
      count: scans.length,
      checkins: scans.map((scan) => ({
        scanId: scan.id,
        scannedAt: scan.scannedAt,
        status: scan.status,
        deviceId: scan.deviceId,
        ticket: {
          id: scan.ticket.id,
          label: scan.ticket.ticketLabel,
          status: scan.ticket.status,
          ticketType: {
            id: scan.ticket.ticketType.id,
            name: scan.ticket.ticketType.name,
          },
        },
        buyer: {
          email: scan.ticket.order.buyerEmail,
          phone: scan.ticket.order.buyerPhone,
        },
      })),
    });
  });

  app.get('/v2/events/:eventId/checkin-summary', async (req, res) => {
    const eventId = req.params.eventId;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const [totalTickets, usedTickets, validScans, duplicateScans] = await Promise.all([
      prisma.ticket.count({ where: { eventId } }),
      prisma.ticket.count({ where: { eventId, status: 'used' } }),
      prisma.scan.count({ where: { ticket: { eventId }, status: 'valid' } }),
      prisma.scan.count({ where: { ticket: { eventId }, status: 'duplicate' } }),
    ]);

    res.json({
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location,
      },
      tickets: {
        total: totalTickets,
        used: usedTickets,
        unused: totalTickets - usedTickets,
      },
      scans: {
        valid: validScans,
        duplicate: duplicateScans,
        total: validScans + duplicateScans,
      },
    });
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

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('UNHANDLED_APP_ERROR', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, prisma };
}
