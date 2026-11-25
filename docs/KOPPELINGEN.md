# Koppelingen: je eigen systemen aan Klaar koppelen

Klaar kan taken ophalen uit elk systeem dat een **Klaar-feed** aanbiedt, zoals een CRM, een boekingssysteem of een webshop. Wat je in Klaar afvinkt, gaat terug naar dat systeem. Zet je ook de Microsoft-synchronisatie aan, dan staan deze taken via de Microsoft To Do-app op je telefoon. Een vinkje daar komt via Klaar ook in je eigen systeem terecht.

```
Je CRM  ⇄  Klaar (laptop)  ⇄  Microsoft To Do  ⇄  To Do-app (telefoon)
```

> Klaar moet daarvoor wel ergens draaien (desktop-app of webversie), want Klaar is de schakel tussen je systeem en Microsoft.

## Instellen in Klaar

**Instellingen → Koppelingen**: vul het adres van de feed en de sleutel in, klik op **Verbinding testen** en daarna op **Opslaan en synchroniseren**. Klaar maakt een eigen lijst aan en synchroniseert elke 2 minuten, een paar seconden na elke wijziging, en zodra je het venster weer opent.

De sleutel wordt nooit meegenomen in back-ups (JSON-export en OneDrive).

## Het formaat (voor ontwikkelaars)

### `GET <adres>`
Met de header `Authorization: Bearer <sleutel>`. Klaar stuurt de sleutel ook als `X-Klaar-Token`, voor servers die de Authorization-header wegfilteren.

```json
{
  "version": 1,
  "name": "Zijlstra CRM",
  "list": { "name": "Opdrachten", "emoji": "🚁" },
  "canUpdate": true,
  "items": [
    {
      "id": "opdracht-12",
      "title": "Luchtfoto's woning Haren — Jan Bakker",
      "note": "Klant: Jan Bakker\nTelefoon: 06-12345678",
      "due": "2026-11-26",
      "reminder": "2026-11-26T09:30:00Z",
      "important": false,
      "done": false,
      "steps": [
        { "key": "geboekt", "title": "Geboekt", "done": true },
        { "key": "betaald", "title": "Betaald", "done": false }
      ],
      "url": "https://crm.example.nl/opdracht_detail.php?id=12"
    }
  ]
}
```

- `id` moet uniek en blijvend zijn.
- Een item dat uit de feed verdwijnt terwijl het nog open is, wordt in Klaar verwijderd (bijvoorbeeld bij een geannuleerde opdracht).
- Items met `done: true` die Klaar nog niet kent, worden niet aangemaakt.
- `title`, `note`, `due`, `reminder` en `important` komen altijd uit de feed. Stappen die de gebruiker zelf in Klaar toevoegt, blijven bewaard.

### `POST <adres>` (alleen als `canUpdate: true`)
Als een stap of de hele taak in Klaar (of op de telefoon) wordt afgevinkt:

```json
{ "id": "opdracht-12", "done": false, "steps": [ { "key": "geboekt", "done": true }, { "key": "betaald", "done": true } ] }
```

Antwoord: `{ "ok": true, "item": { …het bijgewerkte item… } }`

### Beveiliging
- Gebruik altijd **https** (http werkt alleen voor `localhost`, om te testen).
- Stuur `Access-Control-Allow-Origin: *` en `Access-Control-Allow-Headers: Authorization, X-Klaar-Token, Content-Type` mee, zodat de webversie van Klaar erbij kan. Er worden geen cookies gebruikt.
- Een voorbeeld-implementatie in PHP staat in de Zijlstra CRM (`klaar-api.php` en `includes/klaar.php`).
