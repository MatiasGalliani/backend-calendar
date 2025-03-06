import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Obtener la ruta base del proyecto (solución para entornos de despliegue)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración del transportador SMTP con nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false, // STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API funzionante correttamente 🚀");
});

/**
 * GET /availability?date=ISO_DATE[&view=admin]
 */
app.get("/availability", async (req, res) => {
  const { date, view } = req.query;
  if (!date) return res.status(400).json({ error: "Data richiesta" });

  try {
    const availability = await prisma.availability.findUnique({
      where: { date: new Date(date) },
    });

    if (view === "admin") {
      return res.json({ timeSlots: availability ? availability.timeSlots : [] });
    } else {
      const timeSlots = availability
        ? availability.timeSlots
        : [
            { from: "09:00", to: "12:00" },
            { from: "14:00", to: "17:00" },
          ];

      const expandTimeSlots = (timeSlots) => {
        const times = [];
        timeSlots.forEach((slot) => {
          const [fromHour] = slot.from.split(":").map(Number);
          const [toHour] = slot.to.split(":").map(Number);
          for (let hour = fromHour; hour < toHour; hour++) {
            times.push(hour.toString().padStart(2, "0") + ":00");
          }
        });
        return times;
      };

      const allTimes = expandTimeSlots(timeSlots);
      const bookings = await prisma.booking.findMany({
        where: { date: new Date(date) },
      });
      const reservedTimes = bookings.map((b) => b.time);
      const availableTimes = allTimes.filter((time) => !reservedTimes.includes(time));

      return res.json({ availableTimes });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Errore nel recupero della disponibilità" });
  }
});

/**
 * POST /availability
 */
app.post("/availability", async (req, res) => {
  const { date, timeSlots } = req.body;
  if (!date || !timeSlots) return res.status(400).json({ error: "Data o timeSlots mancanti" });

  try {
    const availability = await prisma.availability.upsert({
      where: { date: new Date(date) },
      update: { timeSlots },
      create: { date: new Date(date), timeSlots },
    });
    res.json({ message: "Disponibilità aggiornata", timeSlots: availability.timeSlots });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Errore nell'aggiornamento della disponibilità" });
  }
});

/**
 * POST /bookings
 */
app.post("/bookings", async (req, res) => {
  const { name, email, date, time } = req.body;
  if (!name || !email || !date || !time) {
    return res.status(400).json({ error: "Tutti i campi sono obbligatori" });
  }

  try {
    const existingBooking = await prisma.booking.findFirst({
      where: { date: new Date(date), time },
    });
    if (existingBooking) return res.status(400).json({ error: "Questo orario è già prenotato" });

    const newBooking = await prisma.booking.create({
      data: { name, email, date: new Date(date), time },
    });

    // Envío de email
    await transporter.sendMail({
      from: '"CreditPlan" <no-reply@creditplan.com>',
      to: "it.creditplan@gmail.com",
      subject: "Appuntamento confermato - inviato da €ugenio IA",
      text: `Gentile utente,

Il tuo appuntamento è stato confermato per il ${new Date(date).toLocaleDateString()} alle ${time}.

Questo messaggio è stato inviato da €ugenio IA.

Cordiali saluti,
€ugenio IA`,
      attachments: [
        {
          filename: "eugenio.jpg",
          path: path.join(__dirname, "assets", "logo_eugenio.png"),
          cid: "signatureImage",
        },
      ],
    });

    res.json({ message: "Prenotazione confermata e email inviata", booking: newBooking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Errore nella creazione della prenotazione" });
  }
});

/**
 * GET /bookings
 */
app.get("/bookings", async (req, res) => {
  try {
    const bookings = await prisma.booking.findMany();
    res.json(bookings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Errore nel recupero delle prenotazioni" });
  }
});

// Configurar el puerto para producción
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server in esecuzione su http://0.0.0.0:${PORT}`);
});
