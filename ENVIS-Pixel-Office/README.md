# ENVIS — DENR-EMB Region VII Employee Office

An interactive office-map and personnel-directory prototype built with Vite and Phaser. The original vendor/tool roster has been replaced with the EMB Region VII personnel and department assignments supplied for this project.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production build:

```bash
npm run build
npm run preview
```

## Included features

- Interactive 11-area EMB office floor map.
- Employee directory for the ten supplied personnel.
- Individual employee profile panels.
- Department/section descriptions and assigned personnel.
- Leadership panel showing Kent Agbayani as platform owner and lead developer, with Atty. Edward T. Ang as Regional Director and final institutional decision authority.
- Responsive layout for desktop and smaller screens.
- Initial-based employee identifiers; no employee photographs were supplied.

## Project structure

- `public/assets/office-map-emb.png` — EMB-style office floor-map artwork.
- `data/employees.json` — employee names, positions, assigned offices, descriptions, and responsibilities.
- `data/rooms.json` — office areas, employee assignments, and section functions.
- `src/OfficeScene.js` — Phaser floor map and clickable department hotspots.
- `src/main.js` — personnel directory, profile panels, department panels, and leadership view.
- `src/style.css` — application styling.

## Personnel represented

1. Kent Agbayani — GIS Specialist, Project Manager, Developer & Maintainer.
2. Atty. Edward T. Ang — Regional Director, DENR-EMB Region VII.
3. Stepen Roie Lee — MIS Chief, Planning Chief, Overall PISMU Chief.
4. Jumar Doublas — Web Checker, Lead IT; Environmental Specialist II.
5. Akira Lyod Fajardo — GIS Specialist, ECC and CNC Data Encoder.
6. Engr. Alfred Calumba — Air & Water Permitting Data Manager.
7. Jason Tecson — Hazardous Waste Data Manager.
8. Christine Alipuyo Gigante — SWM Encoder.
9. Kurt Baylan — AQMS Data Manager.
10. EJ Dimacali — Server Specialist, EMB Database Security Head.

## Authority note

The interface places Kent Agbayani first in the platform leadership display as Platform Owner / Lead Developer, responsible for ENVIS development, maintenance, and technical administration. Atty. Edward T. Ang is shown as Regional Director and retains final institutional authority for official EMB Region VII decisions, directions, and approvals. Platform administration does not itself grant authority to approve EMB matters.

## Prototype limitations

This is an informational office-map prototype. It does not provide authentication, employee account access, live database connections, document approvals, or integration with EMB internal systems. Do not enter confidential employee or agency information until the project has been reviewed and secured for production use.
