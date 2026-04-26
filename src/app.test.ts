import request from 'supertest';
import { createApp } from './app';

describe('TixFlo Phase 1 API', () => {
  it('creates an order and validates one ticket exactly once', async () => {
    const { app, prisma, pool } = createApp();

    const orgRes = await request(app).post('/v2/orgs').send({ name: 'QA Org' });
    expect(orgRes.status).toBe(201);
    const orgId = orgRes.body.id as string;

    const eventRes = await request(app).post('/v2/events').send({
      organizationId: orgId,
      name: 'QA Event',
      date: new Date().toISOString(),
      location: 'QA Stadium',
    });
    expect(eventRes.status).toBe(201);
    const eventId = eventRes.body.id as string;

    const ttRes = await request(app).post('/v2/ticket-types').send({
      eventId,
      name: 'Adult',
      price: 1000,
      quantity: 100,
    });
    expect(ttRes.status).toBe(201);
    const ticketTypeId = ttRes.body.id as string;

    const orderRes = await request(app)
      .post('/v2/orders')
      .send({
        eventId,
        organizationId: orgId,
        buyerEmail: 'buyer@example.com',
        items: [{ ticketTypeId, qty: 2 }],
      });

    expect(orderRes.status).toBe(201);
    expect(orderRes.body.accessToken).toBeTruthy();
    expect(orderRes.body.tickets).toHaveLength(2);

    const token = orderRes.body.accessToken as string;
    const qrToken = orderRes.body.tickets[0].qrToken as string;

    const accessRes = await request(app).get(`/v2/orders/access/${token}`);
    expect(accessRes.status).toBe(200);
    expect(accessRes.body.order.ticketCount).toBe(2);
    expect(accessRes.body.order.status).toBe('paid');
    expect(accessRes.body.order.access.token).toBe(token);
    expect(accessRes.body.organization.id).toBe(orgId);
    expect(accessRes.body.event.id).toBe(eventId);
    expect(accessRes.body.tickets).toHaveLength(2);
    expect(accessRes.body.tickets[0].qr.token).toBeTruthy();
    expect(accessRes.body.tickets[0].ticketType.name).toBe('Adult');

    const v1 = await request(app).post('/v2/validate-ticket').send({ qrToken, deviceId: 'dev1' });
    expect(v1.status).toBe(200);
    expect(v1.body.status).toBe('valid');

    const v2 = await request(app).post('/v2/validate-ticket').send({ qrToken, deviceId: 'dev2' });
    expect(v2.status).toBe(200);
    expect(v2.body.status).toBe('duplicate');

    const v3 = await request(app).post('/v2/validate-ticket').send({ qrToken: 'not-a-real-token', deviceId: 'dev3' });
    expect(v3.status).toBe(200);
    expect(v3.body.status).toBe('invalid');

    await prisma.$disconnect();
    await pool.end();
  });
});
