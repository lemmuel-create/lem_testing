/*
 * RF Lab catalog. The hub builds itself from this file, and each tool page reads its own entry for its header,
 * footer and "Relevant FCC regulations" section.
 * Add a tool: append an entry, set status 'planned' until it passes tests, 'review' while awaiting RF sign-off,
 * then 'live'. track: 'common' tools appear under every technology track.
 */
(function (root) {
  'use strict';
  const manifest = {
    labVersion: '0.4.1',
    // Checkup questions are hidden on tool pages for now (kept in the code and in the answer-key doc). Set true to show them.
    showExercises: false,
    tracks: [
      { id: 'halow', title: 'Wi-Fi HaLow', desc: '802.11ah in 902–928 MHz under §15.247.' },
      { id: 'wifi', title: 'Wi-Fi', desc: '802.11b/g/n/ac/ax at 2.4 GHz (§15.247) and 5 GHz U-NII (§15.407).' },
      { id: 'lte', title: 'LTE', desc: 'LTE modules and devices in licensed bands under Parts 22, 24 and 27.' },
      { id: 'cbrs', title: 'CBRS', desc: 'Citizens Broadband Radio Service, 3550–3700 MHz under Part 96 (LTE Band 48 / NR n48).' },
      { id: 'coloc', title: 'Co-location', desc: 'Several radios in one product: harmonics, intermodulation and simultaneous-transmission testing.' }
    ],
    levels: [
      { n: 1, title: 'Fundamentals', desc: 'Units, analyzer settings and the measurement basics every later tool assumes.' },
      { n: 2, title: 'Transmitter limits', desc: 'The parameters a radio is certified against for its band.' },
      { n: 3, title: 'Test setups', desc: 'How conducted, radiated and AC-line measurements are physically made.' },
      { n: 4, title: 'Certification', desc: 'Module vs. full certification, permissive changes and RF exposure.' },
      { n: 5, title: 'Field deployment', desc: 'Range, interference margin and site surveys for customer installs.' }
    ],
    tools: [
      { id: 'template', track: 'common', level: 0, status: 'template', version: '1.0.0', owner: 'RF team', path: 'tools/_template/index.html', title: 'Tool template', summary: 'Starting point for new tools. Not shown on the hub.', refs: [], prereqs: [],
        regulations: [{ cite: '§15.247(e)', req: 'TODO: requirement in one sentence.', use: 'TODO: which control or card in this tool relates to it.' }], guidance: ['TODO: KDB / ANSI references'] },

      /* ---------- common ---------- */
      { id: 'dbm', track: 'common', level: 1, status: 'planned', title: 'dB / dBm converter and power sum', summary: 'Convert mW↔dBm, add signals and noise, and build intuition for logarithmic math.', refs: [], prereqs: [] },
      { id: 'rbw', track: 'common', level: 1, status: 'planned', title: 'RBW and detector explorer', summary: 'See how RBW, VBW and peak/average/quasi-peak detectors change the same signal on screen.', refs: ['ANSI C63.10', 'KDB 971168'], prereqs: ['dbm'] },
      { id: 'eirp-erp', track: 'common', level: 1, status: 'planned', title: 'EIRP, ERP and antenna gain', summary: 'Conducted power, cable loss and antenna gain; when rules use EIRP vs. ERP (2.15 dB).', refs: [], prereqs: ['dbm'] },
      { id: 'conducted-setup', track: 'common', level: 3, status: 'planned', title: 'Conducted test bench walkthrough', summary: 'Interactive antenna-port bench: attenuators, offsets and what each measurement needs.', refs: ['ANSI C63.10', 'KDB 971168'], prereqs: [] },
      { id: 'radiated-setup', track: 'common', level: 3, status: 'planned', title: 'Radiated chamber walkthrough', summary: 'Turntable, height scan, polarization and why the floor changes above 1 GHz.', refs: ['ANSI C63.10'], prereqs: [] },
      { id: 'lisn', track: 'common', level: 3, status: 'planned', title: 'LISN and AC-line conducted', summary: 'How the LISN separates power from noise, with an interactive impedance plot.', refs: ['§15.207'], prereqs: ['dbm'] },
      { id: 'cert-path', track: 'common', level: 4, status: 'planned', title: 'Module vs. full certification', summary: 'Decision tree for module integration, Class II changes and new FCC IDs.', refs: ['§15.212', 'KDB 996369', '§2.1043'], prereqs: [] },
      { id: 'mpe', track: 'common', level: 4, status: 'planned', title: 'RF exposure and co-location', summary: 'MPE distance by band, when SAR applies, and simultaneous transmission (HaLow + Wi-Fi + LTE).', refs: ['§1.1310', 'KDB 447498'], prereqs: ['eirp-erp'] },

      /* ---------- HaLow ---------- */
      {
        id: 'bandwidth', track: 'halow', level: 2, status: 'live', version: '2.1.0', owner: 'RF team',
        path: 'tools/bandwidth/index.html', title: 'HaLow 6 dB bandwidth',
        summary: 'Measure 6 dB / n dB bandwidth, 99% OBW, PSD and band edge on simulated or real analyzer traces.',
        refs: ['47 CFR §15.247(a)(2)', 'KDB 558074'], prereqs: ['dbm', 'rbw'],
        regulations: [
          { cite: '§15.247(a)(2)', req: 'Digitally modulated systems in 902–928 MHz must have a 6 dB bandwidth of at least 500 kHz.', use: 'The pass/fail test this tool performs (6 dB bandwidth and Result cards).' },
          { cite: '§15.247(a)(1)(i)', req: 'Frequency-hopping systems in 902–928 MHz: 20 dB bandwidth up to 500 kHz, 25–50+ hopping channels, 0.4 s dwell limits.', use: 'Where a narrowband signal that fails the 6 dB test has to go instead. Use the 20 dB setting to measure it.' },
          { cite: '§15.247(b)(3)', req: 'Maximum conducted output power of 1 W (+30 dBm).', use: 'Conducted power control and the Integrated channel power card.' },
          { cite: '§15.247(b)(4)', req: 'Antenna gain above 6 dBi reduces the allowed conducted power dB for dB.', use: 'Context for the power and PSD margins; the tool assumes 6 dBi or less.' },
          { cite: '§15.247(d)', req: 'Emissions outside the band must be at least 20 dB below the in-band peak in any 100 kHz (30 dB if power was measured as an average).', use: 'Band edge card at 902 and 928 MHz.' },
          { cite: '§15.247(e)', req: 'Power spectral density of no more than 8 dBm in any 3 kHz band.', use: 'Peak PSD card.' },
          { cite: '§15.215(c)', req: 'The 20 dB bandwidth must stay inside the authorized band under all operating conditions.', use: '20 dB setting; on edge channels, M1 and M2 must stay inside 902–928 MHz.' },
          { cite: '§15.205', req: 'Restricted bands where only spurious emissions are allowed, at §15.209 levels.', use: 'Not measured here. Passing the band-edge check does not cover harmonics in restricted bands.' },
          { cite: '§15.209', req: 'General radiated emission limits (above 960 MHz: 54 dBµV/m average, 74 dBµV/m peak at 3 m).', use: 'Applies to harmonics and spurious emissions; outside this tool’s scope.' },
          { cite: '§15.35', req: 'Detector functions and averaging; where an average limit applies, the peak limit is 20 dB higher.', use: 'Why detector choice (peak vs. average) changes the PSD and power results.' },
          { cite: '§15.31(a)(3)', req: 'Intentional radiators are measured using ANSI C63.10.', use: 'Basis for the measurement method the tool follows.' },
          { cite: '§2.1049', req: 'Occupied bandwidth (99% power) measurement for equipment authorization.', use: '99% occupied bandwidth card.' }
        ],
        guidance: [
          'FCC KDB 558074 D01: DTS measurement guidance (6 dB bandwidth, output power, PSD, band edge)',
          'ANSI C63.10-2013: test procedures for unlicensed wireless devices',
          'ISED RSS-247 and RSS-Gen: Canadian equivalent rules; 99% occupied bandwidth is reported here'
        ]
      },
      { id: 'psd', track: 'halow', level: 2, status: 'planned', title: 'HaLow power spectral density', summary: 'Relate conducted power, bandwidth and the 8 dBm/3 kHz limit; average vs. peak methods.', refs: ['§15.247(e)', 'KDB 558074'], prereqs: ['bandwidth'] },
      { id: 'bandedge', track: 'halow', level: 2, status: 'planned', title: 'HaLow band edge and harmonics', summary: 'Check 902/928 MHz edges and map harmonics against §15.205/15.209 field-strength limits.', refs: ['§15.247(d)', '§15.205', '§15.209'], prereqs: ['bandwidth'] },
      { id: 'link-budget', track: 'halow', level: 5, status: 'planned', title: 'HaLow link budget', summary: 'Range by MCS and channel width with fade and interference margin.', refs: [], prereqs: ['eirp-erp'] },
      { id: 'site-survey', track: 'halow', level: 5, status: 'planned', title: 'HaLow site noise-floor survey', summary: 'Load survey traces, find clean channels and flag RFID, LoRa and paging interferers.', refs: [], prereqs: ['bandwidth'] },

      /* ---------- Wi-Fi ---------- */
      {
        id: 'wifi-24', track: 'wifi', level: 2, status: 'review', version: '1.0.0', owner: 'RF team',
        path: 'tools/wifi-24/index.html', title: 'Wi-Fi 2.4 GHz bandwidth and band edges',
        summary: '§15.247 at 2.4 GHz: 6 dB bandwidth, PSD, the 2400 MHz band edge and the 2483.5 MHz restricted-band limit by channel.',
        refs: ['47 CFR §15.247', '§15.205', 'KDB 558074'], prereqs: ['bandwidth', 'eirp-erp'],
        regulations: [
          { cite: '§15.247(a)(2)', req: 'Digitally modulated systems in 2400–2483.5 MHz must have a 6 dB bandwidth of at least 500 kHz.', use: '6 dB bandwidth and Result cards (all 802.11 modes pass easily).' },
          { cite: '§15.247(b)(3)', req: 'Maximum conducted output power of 1 W (+30 dBm).', use: 'Conducted power control and Channel power card.' },
          { cite: '§15.247(b)(4)', req: 'Antenna gain above 6 dBi reduces allowed conducted power dB for dB.', use: 'Antenna gain input and the power limit shown.' },
          { cite: '§15.247(c)(1)(i)', req: 'Fixed point-to-point links may reduce power only 1 dB per 3 dB of gain above 6 dBi.', use: 'Noted only; the tool applies the standard dB-for-dB rule.' },
          { cite: '§15.247(d)', req: 'Emissions outside the band at least 20 dB below the in-band peak per 100 kHz (30 dB with the average method); emissions in restricted bands must meet §15.209.', use: 'Lower band-edge card at 2400 MHz.' },
          { cite: '§15.247(e)', req: 'PSD no more than 8 dBm in any 3 kHz band.', use: 'Peak PSD card.' },
          { cite: '§15.205', req: '2483.5–2500 MHz and 2310–2390 MHz are restricted bands.', use: 'Restricted-band card: emissions above 2483.5 MHz are judged against an absolute field-strength limit, not a relative one.' },
          { cite: '§15.209', req: 'Above 960 MHz: 54 dBµV/m average and 74 dBµV/m peak at 3 m (≈ −41.2 / −21.2 dBm EIRP).', use: 'Restricted-band limit line on the plot.' },
          { cite: '§15.35(b)', req: 'Peak limit is 20 dB above the average limit.', use: 'Peak vs. average restricted-band limits.' },
          { cite: '§2.1049', req: 'Occupied bandwidth (99% power) measurement.', use: '99% occupied bandwidth card.' }
        ],
        guidance: ['FCC KDB 558074 D01: DTS measurement guidance, including band-edge marker-delta and integration methods', 'ANSI C63.10-2013', 'ISED RSS-247']
      },
      {
        id: 'wifi-unii', track: 'wifi', level: 2, status: 'review', version: '1.1.0', owner: 'RF team',
        path: 'tools/wifi-unii/index.html', title: 'Wi-Fi 5 GHz U-NII power and PSD',
        summary: '§15.407 by sub-band and device class: 26 dB bandwidth, power and PSD limits, antenna gain, out-of-band emissions, DFS and TPC.',
        refs: ['47 CFR §15.407', 'KDB 789033', 'KDB 905462'], prereqs: ['bandwidth', 'eirp-erp'],
        regulations: [
          { cite: '§15.407(a)(1)', req: 'U-NII-1 (5150–5250 MHz): access points 1 W and 17 dBm/MHz; client devices 250 mW and 11 dBm/MHz; outdoor APs limited to 125 mW EIRP above 30° elevation.', use: 'Power and PSD limits for U-NII-1 by device class.' },
          { cite: '§15.407(a)(2)', req: 'U-NII-2A/2C (5250–5350, 5470–5725 MHz): lesser of 250 mW or 11 dBm + 10·log10(B), and 11 dBm/MHz PSD, where B is the 26 dB emission bandwidth in MHz.', use: '26 dB bandwidth card feeds the power limit.' },
          { cite: '§15.407(a)(3)', req: 'U-NII-3 (5725–5850 MHz): 1 W and 30 dBm in any 500 kHz.', use: 'Power and PSD limits for U-NII-3.' },
          { cite: '§15.407(a) (antenna gain)', req: 'Above 6 dBi, reduce conducted power and PSD by the excess gain. Fixed point-to-point exceptions: U-NII-1 up to 23 dBi (§15.407(a)(1)(iii)); U-NII-3 without reduction (§15.407(a)(3)).', use: 'Antenna gain input.' },
          { cite: '§15.407(b)', req: 'Out-of-band emissions: −27 dBm/MHz EIRP outside U-NII-1/2A/2C; U-NII-3 uses a stepped mask from 27 dBm/MHz at the edge down to −27 dBm/MHz at 75 MHz.', use: 'Out-of-band card and limit line.' },
          { cite: '§15.407(e)', req: 'U-NII-3 minimum 6 dB bandwidth of 500 kHz.', use: '6 dB bandwidth note for U-NII-3.' },
          { cite: '§15.407(h)(1)', req: 'Transmit power control in U-NII-2A/2C for devices at 500 mW EIRP or more.', use: 'TPC requirement card.' },
          { cite: '§15.407(h)(2)', req: 'DFS in U-NII-2A/2C: detect radar at −64 dBm (−62 dBm if EIRP < 200 mW and PSD < 10 dBm/MHz); 60 s channel availability check; stop normal traffic within 200 ms and all transmission within 10 s; 30 min non-occupancy.', use: 'DFS requirement card.' },
          { cite: '§15.205 / §15.209', req: '4500–5150 and 5350–5460 MHz are restricted; emissions there must meet 54 dBµV/m average at 3 m (≈ −41.2 dBm EIRP).', use: 'Restricted-band portions of the out-of-band check.' },
          { cite: '§2.1049', req: 'Occupied bandwidth (99% power) measurement.', use: '99% occupied bandwidth card.' }
        ],
        guidance: ['FCC KDB 789033 D02: U-NII measurement procedures (EBW, power, PSD, unwanted emissions)', 'FCC KDB 905462: DFS compliance procedures', 'ISED RSS-247']
      },
      { id: 'wifi-dfs', track: 'wifi', level: 2, status: 'planned', title: 'DFS radar timeline', summary: 'Channel availability check, radar detection, channel move and non-occupancy timing for U-NII-2A/2C.', refs: ['§15.407(h)(2)', 'KDB 905462'], prereqs: ['wifi-unii'] },
      { id: 'wifi-coex', track: 'wifi', level: 5, status: 'planned', title: '2.4 GHz coexistence planner', summary: 'Channel planning around Bluetooth, Zigbee and microwave ovens; 1/6/11 and adjacent-channel interference.', refs: [], prereqs: ['wifi-24'] },

      /* ---------- LTE ---------- */
      {
        id: 'lte-mask', track: 'lte', level: 2, status: 'review', version: '1.1.0', owner: 'RF team',
        path: 'tools/lte-mask/index.html', title: 'LTE device power and emission mask',
        summary: 'Parts 22/24/27 by band: ERP/EIRP limits, occupied bandwidth, the −13 dBm emission mask and PAPR for LTE modules.',
        refs: ['Parts 22H, 24E, 27', 'KDB 971168'], prereqs: ['eirp-erp', 'rbw'],
        regulations: [
          { cite: '§22.913(a)(5)', req: 'Cellular (824–849 MHz) mobile stations: 7 W ERP.', use: 'Band 5 power limit.' },
          { cite: '§24.232(c)', req: 'PCS (1850–1915 MHz) mobile and portable stations: 2 W EIRP.', use: 'Band 2 power limit.' },
          { cite: '§24.232(d) / §27.50(d)(5)', req: 'Peak-to-average power ratio no more than 13 dB.', use: 'PAPR input and card.' },
          { cite: '§27.50(b)(10), (c)(10)', req: '700 MHz and 600 MHz portable stations: 3 W ERP (fixed and mobile stations have higher limits).', use: 'Band 12, 13 and 71 power limits.' },
          { cite: '§27.50(d)(4)', req: 'AWS (1710–1780 MHz) mobile and portable stations: 1 W EIRP.', use: 'Band 4 and 66 power limits.' },
          { cite: '§24.238 / §27.53(h)', req: 'PCS and AWS: emissions outside the block attenuated by at least 43 + 10·log10(P) dB (−13 dBm) in 1 MHz; ≥ 1% of the emission bandwidth may be used in the first 1 MHz.', use: 'Emission mask for Bands 2, 4 and 66.' },
          { cite: '§22.917', req: 'Cellular: 43 + 10·log10(P) dB (−13 dBm) in a 100 kHz reference bandwidth below 1 GHz; ≥ 1% of the emission bandwidth in the first 1 MHz.', use: 'Emission mask for Band 5.' },
          { cite: '§27.53(c), (g)', req: '600/700 MHz: 43 + 10·log10(P) dB (−13 dBm) in 100 kHz; ≥ 30 kHz may be used in the first 100 kHz. Upper 700 MHz mobiles: 65 + 10·log10(P) dB (−35 dBm in 6.25 kHz) in 763–775 and 793–805 MHz.', use: 'Emission mask for Bands 12, 13 and 71, including the Band 13 public-safety limit.' },
          { cite: '§27.53(f)', req: 'Band 13 devices must also protect GNSS: ≤ −70 dBW/MHz EIRP (wideband) and −80 dBW (discrete) in 1559–1610 MHz.', use: 'Noted for Band 13; not simulated.' },
          { cite: '§2.1046', req: 'RF output power measurement for equipment authorization.', use: 'Conducted power and ERP/EIRP cards.' },
          { cite: '§2.1049', req: 'Occupied bandwidth (99% power) measurement.', use: '99% occupied bandwidth card.' },
          { cite: '§2.1051 / §2.1053', req: 'Spurious emissions at the antenna terminals and radiated spurious emissions.', use: 'Basis for the mask check; harmonics are outside this tool’s scope.' },
          { cite: '§2.1055', req: 'Frequency stability over temperature and supply voltage.', use: 'Not simulated; see the planned frequency stability tool.' }
        ],
        guidance: ['FCC KDB 971168 D01: power and emission measurement procedures for licensed digital transmitters', 'ANSI C63.26-2015: compliance testing of licensed transmitters', 'FCC KDB 996369: module integration (when an LTE module is built into a host)']
      },
      { id: 'lte-freqstab', track: 'lte', level: 2, status: 'planned', title: 'LTE frequency stability', summary: 'Frequency error over temperature and voltage, and why it must keep emissions inside the block.', refs: ['§2.1055', '§22.355', '§27.54'], prereqs: ['lte-mask'] },
      { id: 'lte-module', track: 'lte', level: 4, status: 'planned', title: 'LTE module integration and co-location', summary: 'Using a certified LTE module in a HaLow product: antenna gain limits, simultaneous transmission and SAR.', refs: ['KDB 996369', 'KDB 447498'], prereqs: ['lte-mask', 'mpe'] },
      { id: 'lte-bands', track: 'lte', level: 5, status: 'planned', title: 'LTE band and carrier selection', summary: 'Which bands a US deployment needs (2/4/5/12/13/66/71) and what each costs in certification.', refs: [], prereqs: ['lte-mask'] },

      /* ---------- CBRS ---------- */
      {
        id: 'cbrs-mask', track: 'cbrs', level: 2, status: 'review', version: '1.1.0', owner: 'RF team',
        path: 'tools/cbrs-mask/index.html', title: 'CBRS power and emission mask',
        summary: 'Part 96 by device class (EUD, CBSD Category A/B): EIRP per 10 MHz, the three-tier emission mask, PAPR and SAS obligations.',
        refs: ['47 CFR Part 96', '§96.41', 'KDB 940660'], prereqs: ['lte-mask', 'eirp-erp'],
        regulations: [
          { cite: '§96.41(b)', req: 'Maximum EIRP per 10 MHz: end user devices 23 dBm, Category A CBSDs 30 dBm, Category B CBSDs 47 dBm. Maximum PSD: Category A 20 dBm/MHz, Category B 37 dBm/MHz.', use: 'Device class selector, EIRP per 10 MHz and PSD cards.' },
          { cite: '§96.41(e)', req: 'Conducted emissions outside the assigned channel: −13 dBm/MHz within 10 MHz of the channel edge (CBSD) or within B MHz (EUD, B = its channel bandwidth), −25 dBm/MHz beyond; additionally −25 dBm/MHz below 3540 and above 3710 MHz, and −40 dBm/MHz below 3530 and above 3720 MHz. EUD ACLR ≥ 30 dB. 1% EBW resolution allowed in the first 1 MHz.', use: 'Emission mask card, ACLR and the stepped limit line.' },
          { cite: '§96.41(g)', req: 'CBSD transmitters: peak-to-average power ratio no more than 13 dB.', use: 'PAPR card (CBSD classes).' },
          { cite: '§96.39', req: 'CBSDs must register with a SAS, report geolocation and operate only on SAS-authorized channels and power.', use: 'Device class notes (CBSD vs. EUD).' },
          { cite: '§96.43', req: 'Category A and B CBSD deployment limits (antenna height, indoor/outdoor, professional installation).', use: 'Device class notes.' },
          { cite: '§96.47', req: 'End user devices may transmit only when authorized by and under the control of a CBSD.', use: 'EUD notes.' },
          { cite: '§2.1046 / §2.1049', req: 'RF output power and occupied bandwidth measurements.', use: 'Conducted power and occupied bandwidth cards.' },
          { cite: '§2.1051 / §2.1053', req: 'Spurious emissions at antenna terminals and radiated.', use: 'Basis for the mask check.' }
        ],
        guidance: ['FCC KDB 940660: Part 96 CBRS equipment certification guidance', 'WInnForum WINNF-TS-0122: CBSD/DP conformance and certification test specification', 'ANSI C63.26-2015: compliance testing of licensed transmitters']
      },
      { id: 'cbrs-sas', track: 'cbrs', level: 4, status: 'planned', title: 'CBSD registration and SAS grants', summary: 'Registration parameters, grant/heartbeat cycle, and what changes when the SAS suspends or relocates a grant.', refs: ['§96.39', 'WINNF-TS-0016'], prereqs: ['cbrs-mask'] },

      /* ---------- Co-location ---------- */
      {
        id: 'coloc-im', track: 'coloc', level: 2, status: 'review', version: '1.1.0', owner: 'RF team',
        path: 'tools/coloc-im/index.html', title: 'Intermod and spurious planner',
        summary: 'Enter the radios in a host; find harmonics and 2nd/3rd/5th-order intermod products that land in restricted bands, licensed bands or another radio’s receiver, and export a test matrix.',
        refs: ['§15.205', 'KDB 996369', 'ANSI C63.10'], prereqs: ['bandwidth', 'lte-mask'],
        regulations: [
          { cite: '§15.205', req: 'Restricted bands: Part 15 transmitters may only emit spurious emissions there, at §15.209 levels.', use: 'Red bands on the chart and the "Restricted" hits in the table.' },
          { cite: '§15.209', req: 'General radiated limits (above 960 MHz: 54 dBµV/m average, 74 dBµV/m peak at 3 m).', use: 'The limit a restricted-band hit is tested against.' },
          { cite: '§15.247(d) / §15.407(b)', req: 'Unwanted-emission limits for HaLow, 2.4 GHz and 5 GHz Wi-Fi transmitters.', use: 'Apply to harmonics and products generated while those radios transmit.' },
          { cite: '§22.917 / §24.238 / §27.53 / §96.41(e)', req: 'Licensed-band emission limits (−13 dBm, and Part 96 tiers) for LTE and CBRS transmitters.', use: '"Licensed band" hits and LTE/CBRS-generated products.' },
          { cite: '§27.53(f)', req: 'Band 13 emissions in 1559–1610 MHz limited to −70 dBW/MHz EIRP to protect GNSS.', use: 'Band 13 second-harmonic hit on GNSS L1.' },
          { cite: '§2.1051 / §2.1053', req: 'Spurious emissions at antenna terminals and radiated, for licensed transmitters.', use: 'Basis for testing LTE/CBRS products.' },
          { cite: '§2.1043', req: 'Permissive changes: adding or co-locating a transmitter can require a Class II change or a new FCC ID.', use: 'When a co-location finding forces new certification work.' },
          { cite: '§15.31(a)(3)', req: 'Part 15 intentional radiators are measured per ANSI C63.10.', use: 'Radiated test method for simultaneous transmission.' },
          { cite: '§15.33(a)', req: 'Radiated emissions are searched up to the 10th harmonic of the highest fundamental, or 40 GHz, whichever is lower (fundamentals below 10 GHz).', use: 'Harmonics setting (default 10) and the 40 GHz cut for Part 15 radios.' },
          { cite: '§2.1057(a)', req: 'Licensed transmitters: spurious emissions are investigated up to the 10th harmonic of the fundamental.', use: 'LTE and CBRS harmonics are not cut at 40 GHz.' }
        ],
        guidance: ['FCC KDB 996369 D04: module integration, including co-location and simultaneous transmission in the host', 'FCC KDB 447498: RF exposure for simultaneous transmission', 'ANSI C63.10-2013 and ANSI C63.26-2015: radiated spurious test methods']
      },
      {
        id: 'coloc-mpe', track: 'coloc', level: 4, status: 'review', version: '1.0.0', owner: 'RF team',
        path: 'tools/coloc-mpe/index.html', title: 'Simultaneous-transmission RF exposure',
        summary: 'Sum of exposure ratios across radios that transmit at once: MPE for mobile use, SAR test exemption for portable use, and the minimum safe separation.',
        refs: ['§1.1307(b)', '§1.1310', 'KDB 447498'], prereqs: ['coloc-im', 'eirp-erp'],
        regulations: [
          { cite: '§1.1310', req: 'Maximum permissible exposure for the general population: f/1500 mW/cm² for 300–1500 MHz, 1.0 mW/cm² for 1.5–100 GHz; SAR 1.6 W/kg over 1 g.', use: 'MPE limit per radio and the SAR limit for measured values.' },
          { cite: '§1.1307(b)(3)(i)(B)', req: 'SAR test exemption threshold P_th for 300 MHz–6 GHz at 0.5–40 cm, based on ERP at 20 cm and frequency.', use: 'Portable mode: each radio’s available power vs. P_th.' },
          { cite: '§1.1307(b)(3)(ii)', req: 'Multiple transmitters: exemption holds only if the sum of each transmitter’s fraction of its threshold (or limit) is ≤ 1.', use: 'Sum of ratios card and the 1.0 line on the chart.' },
          { cite: '§2.1091', req: 'Mobile devices (≥ 20 cm from people) are evaluated against MPE.', use: 'Mobile/fixed mode.' },
          { cite: '§2.1093', req: 'Portable devices (< 20 cm, body-worn or handheld) are evaluated against SAR.', use: 'Portable mode.' },
          { cite: '§2.1043', req: 'A new co-location or use condition outside a module’s grant needs a Class II permissive change or a new FCC ID.', use: 'Result card: when exposure is not covered by the module grants.' }
        ],
        guidance: ['FCC KDB 447498 D01 (and D04 for the 2019 rules): RF exposure procedures, including simultaneous transmission and SAR-to-peak-location ratios', 'FCC KDB 865664: SAR measurement procedures', 'FCC KDB 996369: module integration and co-location conditions in grants']
      },
      {
        id: 'coloc-plan', track: 'coloc', level: 4, status: 'review', version: '1.0.0', owner: 'RF team',
        path: 'tools/coloc-plan/index.html', title: 'Co-location test plan builder',
        summary: 'From the radios, module grants, antennas and use condition: the certification path for each radio and a lab-ready test matrix, including simultaneous-transmission and RF exposure work.',
        refs: ['KDB 996369', 'KDB 447498', '§2.1043'], prereqs: ['coloc-im', 'coloc-mpe'],
        regulations: [
          { cite: '§15.212', req: 'Modular approval: a certified module may be used in a host under the grant’s conditions (antennas, exposure, co-location).', use: '“Module grant covers it” path.' },
          { cite: '§2.1043', req: 'Permissive changes: Class II for changes that degrade the reported characteristics (higher-gain or different antennas, new exposure conditions, co-location).', use: '“Class II permissive change” path.' },
          { cite: '§2.933', req: 'Change in identification: a host maker may take over a module’s certification under its own FCC ID and file changes itself.', use: 'Alternative when the module grantee won’t file a Class II change.' },
          { cite: '§15.101 / §15.109 / §15.107', req: 'Unintentional radiators: the host’s digital circuitry needs authorization (usually SDoC) against Part 15 Subpart B radiated and AC-conducted limits.', use: 'Host Part 15B rows.' },
          { cite: '§15.207', req: 'AC power-line conducted limits for Part 15 transmitters powered from the mains.', use: 'AC conducted row (mains-powered hosts).' },
          { cite: '§15.205 / §15.209 / §15.33', req: 'Restricted bands, general radiated limits, and the 10th-harmonic search range.', use: 'Simultaneous-transmission radiated spurious rows.' },
          { cite: '§1.1307 / §1.1310 / §2.1091 / §2.1093', req: 'RF exposure: MPE for mobile, SAR (or exemption) for portable, summed for simultaneous transmission.', use: 'RF exposure row.' },
          { cite: '§2.925 / §15.19', req: 'Labeling: FCC ID on the product (“Contains FCC ID” for modules) and required statements.', use: 'Labeling row.' }
        ],
        guidance: ['FCC KDB 996369 D01–D04: modular transmitter integration and host responsibilities', 'FCC KDB 447498: RF exposure, simultaneous transmission', 'FCC KDB 178919: permissive change policy', 'ANSI C63.10 / C63.26: test methods']
      },
      { id: 'coloc-desense', track: 'coloc', level: 5, status: 'planned', title: 'Coexistence and desense margin', summary: 'Antenna isolation needed so one radio’s transmitter doesn’t desensitize another’s receiver.', refs: [], prereqs: ['coloc-im'] }
    ]
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = manifest;
  root.RF = root.RF || {}; root.RF.manifest = manifest;
})(typeof globalThis !== 'undefined' ? globalThis : this);
