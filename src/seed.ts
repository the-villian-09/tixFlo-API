import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const org = await prisma.organization.create({
    data: { name: 'Demo High School' },
  });

  // Next Friday at 7pm UTC as a simple placeholder
  const now = new Date();
  const daysUntilFriday = (5 - now.getUTCDay() + 7) % 7 || 7;
  const nextFriday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilFriday, 19, 0, 0));

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: 'Varsity Football Game',
      date: nextFriday,
      location: 'Home Stadium',
      status: 'published',
    },
  });

  const adult = await prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: 'Adult',
      price: 1000,
      quantity: 500,
    },
  });

  const student = await prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: 'Student',
      price: 500,
      quantity: 500,
    },
  });

  console.log('Seeded:');
  console.log({ orgId: org.id, eventId: event.id, ticketTypes: { adultId: adult.id, studentId: student.id } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
