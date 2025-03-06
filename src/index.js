import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Configurazione del transportador SMTP con nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,      // ex: smtp.gmail.com
  port: Number(process.env.SMTP_PORT),// ex: 587
  secure: false,                     // false per STARTTLS
  auth: {
    user: process.env.SMTP_USER,     // il tuo email
    pass: process.env.SMTP_PASS,     // la tua password per l'app
  },
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API funzionante correttamente 🚀");
});

/**
 * GET /availability?date=ISO_DATE[&view=admin]
 *
 * - Se viene passato view=admin, ritorna: { timeSlots: [...] }
 * - Altrimenti (vista booking), ritorna: { availableTimes: [...] }
 */
app.get("/availability", async (req, res) => {
  const { date, view } = req.query;
  if (!date) return res.status(400).json({ error: "Data richiesta" });
  
  try {
    // Recupera la disponibilità per la data dal database
    const availability = await prisma.availability.findUnique({
      where: { date: new Date(date) },
    });

    if (view === "admin") {
      // Per la vista admin, ritorna direttamente i timeSlots impostati
      return res.json({ timeSlots: availability ? availability.timeSlots : [] });
    } else {
      // Per la vista booking: usa la disponibilità dell'admin, oppure un intervallo predefinito
      const timeSlots = availability
        ? availability.timeSlots
        : [
            { from: "09:00", to: "12:00" },
            { from: "14:00", to: "17:00" },
          ];

      // Funzione per espandere gli intervalli in orari discreti (assumendo slot orari)
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

      // Recupera le prenotazioni per la data
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
 *
 * Riceve nel body JSON:
 * { date: ISO_DATE, timeSlots: [{ from: "09:00", to: "11:00" }, ...] }
 *
 * Aggiorna (o crea) la disponibilità per una determinata data.
 */
app.post("/availability", async (req, res) => {
  const { date, timeSlots } = req.body;
  if (!date || !timeSlots) {
    return res.status(400).json({ error: "Data o timeSlots mancanti" });
  }

  try {
    // Upsert: se esiste, aggiorna, altrimenti crea una nuova entry
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
 *
 * Riceve nel body JSON:
 * { name, email, date, time }
 *
 * Crea una prenotazione e invia una notifica email.
 */
app.post("/bookings", async (req, res) => {
  const { name, email, date, time } = req.body;

  if (!name || !email || !date || !time) {
    return res.status(400).json({ error: "Tutti i campi sono obbligatori" });
  }

  try {
    // Verifica se esiste già una prenotazione per la stessa data e orario
    const existingBooking = await prisma.booking.findFirst({
      where: { date: new Date(date), time },
    });
    if (existingBooking) {
      return res.status(400).json({ error: "Questo orario è già prenotato" });
    }

    const newBooking = await prisma.booking.create({
      data: {
        name,
        email,
        date: new Date(date),
        time,
      },
    });

    // Invio dell'email di notifica
    await transporter.sendMail({
      from: '"CreditPlan" <no-reply@creditplan.com>',
      to: "it.creditplan@gmail.com", // Modifica con l'email di destinazione desiderata
      subject: "Appuntamento confermato - inviato da €ugenio IA",
      text: `Gentile utente,

Il tuo appuntamento è stato confermato per il ${new Date(date).toLocaleDateString()} alle ${time}.

Questo messaggio è stato inviato da €ugenio IA.

Cordiali saluti,
€ugenio IA`,
      html: `<p>Gentile utente,</p>
<p>Il tuo appuntamento è stato confermato per il <strong>${new Date(date).toLocaleDateString()}</strong> alle <strong>${time}</strong>.</p>
<p>Questo messaggio è stato inviato da <strong>€ugenio IA</strong>.</p>
<p>Cordiali saluti,<br/>€ugenio IA</p>
<img src="cid:signatureImage" alt="Firma €ugenio IA" style="width:100px; margin-top:10px;"/>`,
      attachments: [
        {
          filename: "eugenio.jpg",
          path: "C:/Users/matia/Desktop/Creditplan/react project calendar/backend-calendar/assets/logo_eugenio.png", // Assicurati che la path sia corretta
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
 * (Opzionale) Recupera tutte le prenotazioni.
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Server in esecuzione su http://localhost:${PORT}`)
);
