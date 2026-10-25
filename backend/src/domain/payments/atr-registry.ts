/**
 * Payment-card ATR registry
 * ─────────────────────────────────────────────────────────────────────────────
 * The ATR (Answer To Reset, ISO 7816-3) is what the ACR122U reports for every
 * card it sees. This table turns that opaque byte string into "which card and
 * which scheme is this, and is it a payment card at all" — which is what lets
 * the acquirer identify a presented card in the transaction audit trail, and
 * recognise a non-payment card (SIM, eID, health, transit, laundry) before any
 * EMV APDU is attempted.
 *
 * Source: "COMPLETE LIST OF ATRs" (backend/NEW IMPLEMENTS/d19815dfe976f49f.pdf),
 * filtered to payment cards only — Visa / Mastercard / Maestro / Amex / UnionPay /
 * JCB / Diners / Discover, EMV card operating systems, and national bank card
 * schemes (Geldkarte, Proton, Bancontact, CB, Multibanco, …). Non-payment
 * entries are deliberately excluded.
 *
 * REACH: these are predominantly contact (ISO 7816) ATRs from bank cards of the
 * 1990s–2010s. A modern contactless card tapped on an ACR122U often presents a
 * reader-synthesised ATR that is not in this list, in which case only a prefix
 * match can hit. The registry is an identification and audit aid — it is never
 * an authorisation decision, and it must not be used to approve a charge.
 */

/**
 * [pattern, description, scheme].
 *
 * `pattern` is the ATR as uppercase hex in which every '.' is a wildcard nibble
 * pair, e.g. the source entry `3B 2A 00 80 65 A2 01 .. .. .. 72 D6 41` is stored
 * as `3B2A008065A201......72D641`.
 */
const ATR_ENTRIES: ReadonlyArray<readonly [string, string, string]> = [
  ['3B82800103', 'Visa Credit Card, issued by TargoBank', 'Visa'],
  ['3B90160187', 'BIFIT USB-Token iBank2key', ''],
  ['3B6400008062', '0. 51 Setec SetCOS 5.1.0 EMV', 'Generic payment'],
  ['3B240080729443', 'MPCOS-3DES 64K \\ EMV Filter (Gemplus)', 'Generic payment'],
  ['3B260011016D03', 'OLD CajaMadrid Visa Cash, ID card for Universidad Autónoma de Madrid, Madrid (about 1998)', 'Visa'],
  ['3BF01300001000', 'MasterCard ETEC InterOp 27. This is an dual-app Maestro/MasterCard Credit EMV test card', 'Maestro'],
  ['3B06812480809000', '10€ credit card for TV & telephone in Jerez de la Frontera hospital’s rooms. The maker can be found at (ISERN Medical Telecomunications)', 'Generic payment'],
  ['3B6400FF806202A2', 'VISA credit card (Nordea bank)', 'Visa'],
  ['3B8580012063CBA0', 'Visa card from Banque populaire du nord/Casden', 'Visa'],
  ['3B8580012063CBA1', 'AIB Visa Debit Card, manufcatured by Oberthur (NFC interface)', 'Visa'],
  ['3B8580012063CBAD', 'Santander VISA Debit Card', 'Visa'],
  ['3F6525....046C90', '.0 Carte Bancaire (French banking card)', 'Generic payment'],
  ['3B260011045C039000', 'Caixa Abierta (Barcelona, Spain) Cash/Visa Electron', 'Visa'],
  ['3B260031086C039000', 'VISA ELECTRON from Caixa Catalunya bank card for students in UPC university of Barcelona (Spain)', 'Visa'],
  ['3B6500002063CB6300', 'Bank card from Societe Générale (Oberthur)', 'Generic payment'],
  ['3B6500002063CB6480', 'MasterCard from La Banque Postale', 'Mastercard'],
  ['3B6500002063CB6600', 'Boursorama banque VISA (bank)', 'Visa'],
  ['3B6500002063CB6680', 'Crédit Agricole (french bank) MasterCard', 'Mastercard'],
  ['3B6500002063CB6800', 'VISA credit card (Skandiabanken) VISA credit card (Banque Populaire) Banque Postale card (bank) Société Générale (visa / jazz) HSBC Business VISA', 'Visa'],
  ['3B6500002063CB6880', 'Capital One MasterCard Platinum', 'Mastercard'],
  ['3B6500002063CB6A00', 'Visa La Banque Postale (Gemalto) CB Visa BNP Paribas (France)', 'Visa'],
  ['3B6500002063CB6A80', 'Mastercard EMV Debit Card Crédit Agricole (french bank) Gold Mastercard', 'Mastercard'],
  ['3B6500002063CB6B80', 'Crédit Agricole (french bank) Mastercard', 'Mastercard'],
  ['3B6500002063CBA000', 'Visa Banque Populaire (France)', 'Visa'],
  ['3B6500002063CBA080', 'Carrefour, MasterCard credit card, Pass Banque, Oberthur', 'Mastercard'],
  ['3B6500002063CBA100', 'AIB Visa Debit Card, manufcatured by Oberthur', 'Visa'],
  ['3B6500002063CBA180', 'bpaid: bpost prepaid Mastercard', 'Mastercard'],
  ['3B6500002063CBA300', 'BNP VISA CARD', 'Visa'],
  ['3B6500002063CBA320', 'MasterCard Crédit Agricole Anjou-Maine (type Sociétaire)', 'Mastercard'],
  ['3B6500002063CBA3A0', 'VISA card from Banque Populaire', 'Visa'],
  ['3B6500002063CBA720', 'ING Direct (French Bank) Gold MasterCard', 'Mastercard'],
  ['3B6500002063CBA8A0', 'HSBC VISA Card', 'Visa'],
  ['3B6500002063CBAB80', 'Portugal Caixa Geral de Depósitos Mastercard “Caixa Classic”', 'Mastercard'],
  ['3B6500004156494F4E', 'RBC (Royal Bank of Canada) Avion Visa', 'Visa'],
  ['3B65000043046C9000', 'Carte Bancaire (French banking card) (hot reset)', 'Generic payment'],
  ['3B6500005801010080', 'RBS Advanta Platinum Reserve Master Card UK Lloyds TSB Visa Debit (issued 2003, Gemplus)', 'Visa'],
  ['3B650000D000370080', 'Visa Debit card issued by National Bank of Dubai', 'Visa'],
  ['3B8680013930433032', 'Chase Freedom VISA card', 'Visa'],
  ['3B8680014449203032', 'Lufthansa Miles & More Gold MasterCard PayPass Raiffeisen Bank, Russia, MasterCard paypass card', 'Mastercard'],
  ['3B8680014B4F4E4112', 'Citibank Russia, Mastercard paypass', 'Mastercard'],
  ['3B8680014B4F4E4114', 'Mastercard paypass enabled credit card', 'Mastercard'],
  ['3F65250843046C9000', 'visa La Poste France (Oberthur) CB visa Societe Generale France (Oberthur)', 'Visa'],
  ['3F65250863046C9000', 'visa La Poste France (Oberthur) CB Master Carte du Crédit Mutuel', 'Visa'],
  ['3F65250865046C9000', 'visa Boursorama France (Axalto)', 'Visa'],
  ['3B660000314B01010080', 'VISA credit card (Skandiabanken)', 'Visa'],
  ['3B66000032D000300201', 'Kazakhstan Kazkom Onlinebank (Homebank) PKI client key-card', 'Generic payment'],
  ['3B660000D00047440080', 'VISA credit card (RBC Royal Bank)', 'Visa'],
  ['3B6600FF4A434F503330', 'JCOP30 “OP-DI 16k VISA v2 (JCOP30) ORGA”', 'Visa'],
  ['3B8780018031C073D621', 'Sparkasse Hannover – German contactless GeldKarte (RFID, NFC, girogo)', 'Generic payment'],
  ['3BEF00FF8131..456563', 'Debit card (Germany): ec-cash, GeldKarte(DEM), Maestro, Cirrus', 'Maestro'],
  ['3FEF00FF8131..456563', 'Debit card (Germany): ec-cash, GeldKarte(DEM), Maestro, Cirrus', 'Maestro'],
  ['3B37130080621104829000', 'Swiss UBS Maestro/CASH Bank Card', 'Maestro'],
  ['3B37130080622113829000', 'Swiss UBS Maestro/CASH Bank Card', 'Maestro'],
  ['3B67000000000000009000', 'Axa Bank (Belgium) Mastercard Gold / Axa Bank Belgium MisterCash & Proton card VISA Card (emitted by Bank Card Company – Belgium)', 'Mastercard'],
  ['3B67000000002000009000', 'BankID card from Sparebank1', 'Generic payment'],
  ['3B67000000318071869000', 'Swiss ZKB-Bancomat-Card', 'Generic payment'],
  ['3B6700002920006F789000', 'ING (previously Postbank Chippas) (chipknip) Netherlands Rabobank bankcard (dutch) ASN Bank debit card SNS Bank debit card ABN-AMRO Maestro', 'Maestro'],
  ['3B6700002D203600789000', 'Swedish cashcard, Bank Card (ING – Belgium) Schiphol Group Privium biometric card (Amsterdam Airport entry system)', 'Generic payment'],
  ['3B6700007C2040342B9000', 'Swedbank Visa card', 'Visa'],
  ['3B6700007D2040343B9000', 'Nordea Visa Sweden', 'Visa'],
  ['3B67000080622113829000', 'UBS MAESTRO CARD (Bank)', 'Maestro'],
  ['3B67000085203630789000', 'Belgium Fortis Bank Belgium Keytrade Bank Belgium Post Bank', 'Generic payment'],
  ['3B67000085221631789000', 'Swiss UBS Ebanking Chipcard', 'Generic payment'],
  ['3B67000085221631789F00', 'UBS Token Card (bank)', 'Generic payment'],
  ['3B670000A52040101F9000', 'Swedish eLegitimation (eID) from Nordea Bank', 'Generic payment'],
  ['3B670000A6404000099000', 'Visa card issued by Norway bank DNBNor; VISA Classic – Landkreditt Bank (Norway); VISA Classic – Nordea Bank (Norway); VISA Gold – Nordea Bank (Norway', 'Visa'],
  ['3B670000AB404026099000', 'Swedish VISA credit card (Volvofinans)', 'Visa'],
  ['3B670000AB4040270B9000', 'Sparebanken Vest, Norway (spv.no). Visa credit card and national debit card [BankAxept] + Gemalto Todos authentication', 'Visa'],
  ['3B670000B14040330B9000', 'Sparebank1 VISA card, Norway', 'Visa'],
  ['3B670000B34040003B9000', 'Handelsbanken BankID card (Swedish bank authentication issued 2011)', 'Generic payment'],
  ['3B670000C13040010B9000', 'MC/Maestro card issued by Czech’s “Ceskoslovenska obchodni banka”', 'Maestro'],
  ['3B670000C43040010B9000', 'MasterCard issued by Czech’s “Ceskoslovenska obchodni banka” Swedish Maestro bank card (Handelsbanken)', 'Maestro'],
  ['3B670000C53040010B9000', 'Banking card (Oberthur C.S. 03 1027069)', 'Generic payment'],
  ['3B6725002920006F789000', 'Albert Heijn klantenkaart (loyalty card) Rabopas (Rabobank)', 'Generic payment'],
  ['3B8880010073C840000090', 'NXP JCOP 31 V2.2 36K – RFID I/F Barclaycard Visa Wave & Pay – RFID I/F', 'Visa'],
  ['3BE600FF8131FE45444920', 'Alior Sync (Poland) – MasterCard Debit Card with PayPass (Bank) MasterCard Contactless Debit Card issued by Raiffeisen Bank in Czech Republic', 'Mastercard'],
  ['3F6725002120000F789000', 'Bank Nederlandse Gemeenten, BNG Data Services', 'Generic payment'],
  ['3F6725002A200040689F00', 'Swiss Cash card Chipknip SNS Bank (banking card)', 'Generic payment'],
  ['3B29008072A4456400FF0010', 'MPCOS-3DES 8K (Gemplus) MBNA Europe Platinum Plus Mastercard MasterCard Card – Worldcard – Yapıkredi / Turkey Portugal BPI Visa Electron UCFIN (Italy)', 'Mastercard'],
  ['3B6800000073C84000009000', 'Barclaycard Visa Wave & Pay – Chip I/F', 'Visa'],
  ['3B6800000073C84010009000', 'Icelandic Banking scheme Issued by the Ministry of Treasure in Iceland', ''],
  ['3B6800000073C84011009000', 'Woolworths Everyday Money prepaid Mastercard Nordea Bank Norway Visa + national debet card [BankAxept] VISA Classic – Nordlandsbanken (Norway)', 'Mastercard'],
  ['3B6800000073C84013009000', 'MASTERCARD issued by MLP (Marschollek, Lautenschläger and Partner) G&D 12696-GDM-10/11 DEBIT CARD issued by BANCO DE CREDITO DEL PERU', 'Mastercard'],
  ['3B6800000102109600009000', 'Italian BancoPostaClick Postamat Card (Poste Italiane) – MasterCard debit card mbna PLATINUM MasterCard Flash (Banca Fideuram) Italy prepaid Mastercar', 'Mastercard'],
  ['3B680000565344434C433130', 'VISA (Estonian), made by Latvian bank “Latvijas Krajbanka” (VISA Electron)', 'Visa'],
  ['3B6800008062003C83009000', 'Italian PostePay prepaid VISA-Electron PagoBancomat (Debtcard) Maestro – Intesa Sanpaolo Bank / Italy', 'Maestro'],
  ['3B6800008062004583009000', 'MasterCard – Intesa Sanpaolo Bank / Italy', 'Mastercard'],
  ['3B6800008066575901000803', 'Spanish ULPGC student id card E-Money capability Alliance With La Caja de Canarias Bank Manufactured by GyD IBÉRICA', 'Generic payment'],
  ['3B6800008066A20601016400', 'Visa card issued by Czech’s “Komercni banka” (Gemplus brand on chip)', 'Visa'],
  ['3B6800009D03020101564953', 'Visa Card – SberBank / Russia', 'Visa'],
  ['3B6800009D08010201564953', 'Visa Card – bonus – DenizBank / Turkey', 'Visa'],
  ['3B6800009D080103014F5453', 'MasterCard Card – bonus – Garanti Bank / Turkey', 'Mastercard'],
  ['3B6800009D08010301564953', 'MasterCard Card – bonus – Garanti Bank / Turkey MasterCard Card – bonus plus (paypass) – Garanti Bank / Turkey', 'Mastercard'],
  ['3B6800009D08010501564953', 'MasterCard Card – CartaSi (Italian Credit Card)', 'Mastercard'],
  ['3B680000A102020101564953', 'UK NatWest Business MasterCard UK Barclaycard VISA UK NatWest Platinum MasterCard Visa Card – DenizBank / Turkey', 'Mastercard'],
  ['3B6800FF0073C84000009000', 'Visa credit card for Bank of Taiwan CommSec Debit MasterCard (Australia)', 'Mastercard'],
  ['3B898001454D562030332020', 'Lufthansa Miles & More Gold MasterCard PayPass (old one) Found a reference pointing to NXP', 'Mastercard'],
  ['3BE700FF8131FE454430382E', 'EMV (MasterCard) card, issued by Raiffeisen Bank in Russia “Deutsche Kreditbank AG” Visa Card produced by AustriaCard GNC All cards (MasterCard, Maest', 'Mastercard'],
  ['3B2A008065A201......72D641', 'Gemplus MPCOS EMV 1 Byte sectors', 'Generic payment'],
  ['3B2A008065A201......72D643', 'Gemplus MPCOS EMV 4 Byte sectors', 'Generic payment'],
  ['3B2A008065A20101013C72D643', 'Estonian bank “SEB” (VISA Electron)', 'Visa'],
  ['3B2A008065A20102013172D643', 'MPCOS-EMV 64K Functional Sample', 'Generic payment'],
  ['3B6900002494010000000001A9', 'Kazakhstan Helios gas station debit card', 'Generic payment'],
  ['3B6900004A434F503331563232', 'Visa Europe Sample Card / Axalto', 'Visa'],
  ['3B6900005649535F494E462006', 'VISA credit card (Ceska Sporitelna) Maestro credit card (Ceska Sporitelna)', 'Maestro'],
  ['3B6900008031E0554245524753', 'Banrisul Bank', 'Generic payment'],
  ['3B781300000073C84010009000', 'credit/debit card from issued by Finnish credit authority Luottokunta Oy', 'Generic payment'],
  ['3BE80000813120450073C84000', 'Visa credit card for Standard Chartered, Taiwan', 'Visa'],
  ['3BE800008131FE450073C84000', 'VISA Card (Skandinaviska Enskilda Banken) with Swedish BankID V ISA card (Chinatrust Bank (Taiwan), dual-interface card with a Taipei Metro e-purse fu', 'Visa'],
  ['3B6A00008031C0A1020301328116', 'Lloyds TSB Visa Credit/Debit Card', 'Visa'],
  ['3B6A00008065A20103018D72D643', 'American Express Blue Card', 'American Express'],
  ['3B6A00008066A1090201630E9000', 'Danish Visa/Dankort UK MBNA MasterCard Visa Card – Worldcard – YapıKredi / Turkey VISA – Lloyds TSB DEBIT UK Halifax Visa Debit', 'Mastercard'],
  ['3B6A00008066A20A01018B0E9000', 'CAP-EMV demo card', 'Generic payment'],
  ['3B791800008054434F4C44829000', 'LBB VISA Card', 'Visa'],
  ['3B8B80010031C0641F2701000090', 'American Express Platinum Card', 'American Express'],
  ['3B8B80010B788082024449203032', 'Mastercard Debit issued by Raiffeisen bank in Czech Republic', 'Mastercard'],
  ['3BB794008131FE5553504B323290', 'Dresdner Bank (a German Bank) Key-Card for InternetBanking', 'Generic payment'],
  ['3BB794008131FE6553504B323390', 'Giesecke & Devrient Starcos 2.3 Deutsche Bank WebSign (RSA-Card) G&D StarSign Token', 'Generic payment'],
  ['3BE90000812145454D565F415452', 'VISA card, issued by HVB Bank Czech Republic or austrian BankAustria', 'Visa'],
  ['3BE900008121454D435F5F494E46', 'MasterCard Credit card issued by SpareBank1 in Norway', 'Mastercard'],
  ['3BE900008121455649535F494E46', 'VISA card, issued by the Austrian “Raiffeisen” bank Visa Card – Maximum – Oyak Bank / Turkey VISA, issued by Austrian bank “Erste Bank” VISA card, iss', 'Visa'],
  ['3BE900008131FE45434432690900', 'Swiss UBS MasterCard Creditcard', 'Mastercard'],
  ['3BE900008131FE45454D56203033', 'Visa credit card MasterCard credit card', 'Mastercard'],
  ['3BE900008131FE45454D5630325F', 'Maestro Card issued by “First Investment Bank” in Bulgaria, Visa Electron card: TATRA BANKA, a.s.', 'Maestro'],
  ['3BE900008131FE454D4341203033', 'PayLife Gold MasterCard — an unbranded version of the master card', 'Mastercard'],
  ['3F6A000000640150010C820101A9', 'Credit Card café Selecta', 'Generic payment'],
  ['3B5B96000031C064C6FC1000019000', 'Banking card (Oberthur C.S. 06 18710-04-10)', 'Generic payment'],
  ['3B5B96000031C064C7FC1000019000', 'EBanking card (Oberthur C.S. 03 1146821)', 'Generic payment'],
  ['3B6B00008065A109030197830E9000', 'Visa Card – Worldcard – YapıKredi / Turkey', 'Visa'],
  ['3B7A110002484F5354060319029000', 'Swedish bankcard with Mastercard from ICA-banken', 'Mastercard'],
  ['3B7A180000736674652D6364303830', 'HYPOnet online banking card / Croatia', 'Generic payment'],
  ['3B8C8001507F9C668A000000000081', 'NFC Mastercard issued by CSOB bank Czech Republic, first 4 digits 5168', 'Mastercard'],
  ['3BAB00813140458031C06508068000', 'Reloadable Visa Cash card (Schlumberger), Bank of America', 'Visa'],
  ['3BEA00008131FE45436F6D624F5320', 'UBS VISA Gold Card MasterCard from lhv.ee Nordea Bank Finland PLC Estonian Branch (ABnote)', 'Mastercard'],
  ['3BEA00008131FE454A434F50333156', 'NAB VISA Debit card', 'Visa'],
  ['3BF71100008171FE42000063950101', 'ATM Card for Mega International Commercial Bank, Taiwan ATM card for HSBC Direct, Taiwan ATM card for TaChong Bank, Taiwan ATM card for Chunghwa Post,', 'Generic payment'],
  ['3BF71100008171FE42000063953102', 'VISA card for Taipei Fubon Bank, Taiwan', 'Visa'],
  ['3BF71100008171FE42000063953105', 'ATM card for Chunghwa Post, Taiwan ATM card for E.Sun Commercial Bank, Taiwan', 'Generic payment'],
  ['3B7B1800000031C064C6FC1000079000', 'Sberbank of the RUSSIAN federation', ''],
  ['3BF91300FF10808031E0554245524753', 'Banrisul bank', 'Generic payment'],
  ['3F2D0027A051827D00000052000C9000', 'Porta Moedas Multibanco (Portugeese electronic purse)', 'Generic payment'],
  ['3F6C00003DA030BE4100370100049000', 'Sberbank (Bank)', 'Generic payment'],
  ['3B6D0000003180642DA0040C71968C6129', 'UK Co-operative Bank Visa Debit (produced 2002)', 'Visa'],
  ['3B6D00000031C071D66411223301839000', 'Egg (bank) VISA First Direct (bank) Maestro card First Direct Gold VISA UK Barclaycard Platinum VISA UK Barclaycard VISA UK Halifax Platinum VISA UK H', 'Maestro'],
  ['3B6D00000031C071D66419160100849000', 'Eurocard Corporate MasterCard issued by Eurocard AB Sweden Capital One (UK) MasterCard VISA card, issued by Swedbank Latvia VISA issued by Citibank In', 'Mastercard'],
  ['3B6D00000031C071D66438D00200849000', 'EMV Visa Electron (Oberthur)', 'Visa'],
  ['3B6D00000031C071D66438D00300849000', 'HSBC Visa/MasterCard credit card Barclay Card MasterCard', 'Mastercard'],
  ['3B6D00000031C071D6644ED80101849000', 'UK Capital One Platinum MasterCard', 'Mastercard'],
  ['3B6D00000031C071D66458D70100849000', 'UK Nationwide Bank Visa Delta UK First Direct Maestro UK Halifax Platinum Visa UK Co-operative Bank Visa Debit (produced 2003-2004) UK HSBC LiveCash S', 'Maestro'],
  ['3B6D00000031C071D66511223301839000', 'UK Co-operative Bank Visa Debit (produced 2006)', 'Visa'],
  ['3B6D000080318065B00601017783009000', 'GemXpresso Lite: with EMV application', 'Generic payment'],
  ['3B6D000080318065B08301029083009000', 'DeutscheBank Identification card', 'Generic payment'],
  ['3B6D000080318065B08626010883089000', 'RBC Royal Bank VISA (Bank)', 'Visa'],
  ['3B6D000080318065B0872701BC83089000', 'Kazcommertsbank one of the biggest banks in Republic of Kazakhstan Nordea (Finland) + Finnair MasterCard (credit)', 'Mastercard'],
  ['3B6D00008067A1110101640855830E9000', 'Italian Intesa SanPaolo Maestro', 'Maestro'],
  ['3B6D00FF003180718E6448D50200829000', 'Blue for Business, American Express@Business', 'American Express'],
  ['3B8E8001137880800246494F4D4B5F3030', 'MasterCard/PayPass Card issued by Czech FIO Banka a.s. (contactless chip) note the ASCII string ‘FIOK_001N’ embedded in ATR', 'Mastercard'],
  ['3B8E800180318066B0070300AC01830090', 'BCA Flazz Card (Bank)', 'Generic payment'],
  ['3B8E800180318066B08412016E01830090', 'Contactless Barclaycard Visa', 'Visa'],
  ['3BDB960080B1FE451F830031C064BE1B01', 'Bank card', 'Generic payment'],
  ['3BF59100FF918171FE4000420001008186', 'American Express Blue RFID', 'American Express'],
  ['3B2F00806910800001A10A010159830E9000', 'Belgium Dexia (Axion) Bank Card Proton/Bancontact Mister Cash/Maestro', 'Maestro'],
  ['3B6E00000031807186650164022232809000', 'MasterCard Card – bonus plus (paypass) – Garanti Bank / Turkey', 'Mastercard'],
  ['3B6E00000031807186650164022232839000', 'MasterCard Card – bonus YKM – Garanti Bank / Turkey', 'Mastercard'],
  ['3B6E0000003180718665016702A00A839000', 'Australian ANZ First Visa Card from the ANZ (Australia and New Zealand) Bank', 'Visa'],
  ['3B6E00000031807186654744240181839000', 'MasterCard Card – Maximum – IS Bank / Turkey Visa Card – Axess – Akbank / Turkey', 'Mastercard'],
  ['3B6E00000031C06554B601008471D68C612C', 'Kazakhstan Centrcredit bank VISA electron card', 'Visa'],
  ['3B6E00000031C06554B601008471D68C6131', 'UK BARCLAYS VISA Connect Debit card. The chip is used for the Chip&PIN application common for all UK-issued cards:', 'Visa'],
  ['3B6E00000031C06576B401016071D68C611F', 'MasterCard Silver from Viseca Card Services SA', 'Mastercard'],
  ['3B6E00000031C06577B201014771D68C6133', 'VISA Credit Card (National Bank of Greece)', 'Visa'],
  ['3B6E00000031C06577B201034771D68C6131', 'UK Barclaycard Business VISA Nationwide Building Society (UK) Visa Debit and Credit Cards', 'Visa'],
  ['3B6E00000031C06577B201034771D68C6137', 'Italian Soldintasca Sanpaolo prepaid VISA-Electron', 'Visa'],
  ['3B6E00000031C06577B301007071D68C61..', 'Italian Bancomat (debit card)', 'Generic payment'],
  ['3B6E00000031C0657CB501008071D68C612C', 'Kazakhstan Kazkom bank VISA electron card', 'Visa'],
  ['3B6E00000031C0657CB501008071D68C6135', 'MasterCard Classic, issued by Avangard Bank (Russia)', 'Mastercard'],
  ['3B6E00000031C0657CB501008071D68C6137', 'Swedbank MasterCard card', 'Mastercard'],
  ['3B6E00000031C065BCD002010671D68C612E', 'Lloyds TSB Mastercard Credit Card', 'Mastercard'],
  ['3B6E00000031C065BCD002010671D68C6133', 'Lloyds TSB Visa Debit Barclays Visa DEBIT', 'Visa'],
  ['3B6E00000031C065BCD002010671D68C6143', 'S-pankki (Finland) Visa Debit', 'Visa'],
  ['3B6E00000031C065BCD102010171D68C6133', 'Travelex Cash Passport – Prepaid MasterCard Currency Card', 'Mastercard'],
  ['3B6E00000031C065BCD102010171D68C6135', 'MasterCard Card, issues by Rabobank in the Netherlands', 'Mastercard'],
  ['3B6E00000031C065D3C102012871D68C6122', 'Visa debit card', 'Visa'],
  ['3B6E00000031C065D3C102012871D68C6133', 'SberBank Silver Debit Card', 'Generic payment'],
  ['3B6E00000031C065D3C102012871D68C6139', 'Paypal Italy prepaid Mastercard', 'Mastercard'],
  ['3B6E00000031C065D3C202000571D68C6135', 'Italian Intesa SanPaolo VISA', 'Visa'],
  ['3B6E00000031C065D3C202000571D68C6139', 'Italian Bancomat (Cassa di Risparmio di Rimini) (bank card)', 'Generic payment'],
  ['3B6E00000031C065D3C302030171D68C613B', 'American Express Platinum from Banco do Brasil', 'American Express'],
  ['3B6E00000031C065E2C402010171D68C6122', 'mastercard (Bank)', 'Mastercard'],
  ['3B6E00000031C065E2C402020171D68C6125', 'Spanish “Santander” bank – Maestro debit card – Made by gemalto sp SA', 'Maestro'],
  ['3B6E00000031C065E7D202011071D68C6123', 'Visa debit card: mBank – BRE Bank SA', 'Visa'],
  ['3B6E00000031C065E7D202011071D68C6137', 'UCFIN (Italy) “UniCreditCard Free” or “Plus” (VISA or MasterCard) credit card', 'Mastercard'],
  ['3B6E00000031C065E7D202011071D68C6147', 'Hellenic Bank Visa Electron (Gemalto)', 'Visa'],
  ['3B6E00000031C065ECD402000871D68C6133', 'Victoria Bank (Republic of Moldova) – Visa Electron', 'Visa'],
  ['3B6E00000031C07186650164022233839000', 'UK NatWest ServiceCard 100 Maestro Visa Card – bonus – Garanti Bank / Turkey UK Royal Bank of Scotland Highline Maestro Debit', 'Maestro'],
  ['3B6E00000031C07186650178012734839000', 'UK NatWest ServiceCard 100 Maestro Visa Card – Gold – CARDFINANS / Turkey', 'Maestro'],
  ['3B6E00000031C071866501BB01133B839000', 'NatWest Servicecard 100 – Maestro ATM NatWest Visa Debit', 'Maestro'],
  ['3B6E00000031C07186650202040441839000', 'CIBC (Canada) “Platinum” (VISA) credit card ING Direct (Italy) “Gold” (VISA) credit card ING Direct (Italy) “Bancomat” (V PAY) debit card HSBC (Canada', 'Visa'],
  ['3B6E00000031C071C66501B0010337839000', 'NatWest (UK) “Business” (MasterCard) credit card NatWest (UK) (Maestro) debit card Santander Totta (Portugal) “JÁ KÁ KONTA” (VISA Electron) debit card', 'Maestro'],
  ['3B6E00000031C071C66501B001033A839000', 'MasterCard hostet by Deutsche Bank, Germany Maestro card by Caja de Burgos, Spain MasterCard Debit Card issued by Spain Openbank', 'Maestro'],
  ['3B6E00000031C071C66501B0013137839000', 'Electron VISA Credit Card (BANK OF Cyprus)', 'Visa'],
  ['3B6E00000031C071C665422C013535839000', 'UniCredit (Italy) “UniCreditCard Classic” (VISA) credit card', 'Visa'],
  ['3B6E00000031C071C665710C043536839000', 'NatWest VISA Business Debit VISA Debit Card (NatWest / ING DiBa) Komercni Banka, A.S., Visa Debit, Czech Republic', 'Visa'],
  ['3B6E00000031C071D665120D018100839000', 'VISA Gold (VISA ORO) from the Spanish branch of ING Direct (bank) Visa Credit Card issued by Spain Cetelem for PayPal MasterCard debit card: moneybook', 'Mastercard'],
  ['3B6E00000031C071D6657DE40110A0839000', 'VISA card, issued by the ANWB, the Dutch national Automobile club VISA Card – Maximum – Oyak Bank / Turkey VISA – Barclays Premier', 'Visa'],
  ['3B6E00000031C071D6657DE40111A0839000', 'UK CapitalOne Platinum Mastercard', 'Mastercard'],
  ['3B6E00000031C071D66594E8034000839000', 'First Direct UK VISA Debit Italian Cariparma Maestro “Net+ Mastercard card” from netpluscards.com, Neteller UCFIN (Italy) “UniCreditCard Free” (VISA) ', 'Maestro'],
  ['3B6E00000031C071D665A303018000839000', 'UK First Direct (HSBC) Maestro / Cirrus UK Capital One Platinum MasterCard HSBC Commercial Card Visa VISA issued by Czech’s “Komercni banka” (member o', 'Maestro'],
  ['3B6E00000031C071D665CE0B014000839000', 'Nationwide InvestDirect (bank) SberBank Gold Credit Card (VISA)', 'Visa'],
  ['3B6E000000620000574156414E5410819000', 'Setec SetCOS 5.1.0 EMV + AVANT', 'Generic payment'],
  ['3B6E00005744361369869302321256282532', 'Watchdata Brazil CSP v1.0 (Banco do Brasil)', 'Generic payment'],
  ['3B6E000080318065B00301015E8300009000', 'FirstUSA Visa', 'Visa'],
  ['3B6E000080318066B0070300AC0183009000', 'e-payment card with topup system, propreteary by local bank', 'Generic payment'],
  ['3B6E000080318066B0840C016E0183009000', 'Nordea (a Skandinavian bank) eID card', 'Generic payment'],
  ['3B6E000080318066B08412016E0183009000', 'Barclaycard Platinum VISA Inteligo debit card', 'Visa'],
  ['3B6E000080318066B08416016E0183009000', 'UK “Barclaycard Gold VISA” with RFID', 'Visa'],
  ['3B6E00FF00620000574156414E5410819000', 'debit card (Visa Electron) issued by Nordea bank', 'Visa'],
  ['3B6E00FF47442D47502D333256342D444553', 'Mastercard Ourocard Platinum from Banco do Brasil', 'Mastercard'],
  ['3B7D94000080318065B08302047E83009000', 'GXP Pro R3.2 64K, GemSafe applet MPCOS v1.11 card issued by Czech National Bank dual card: chip used for electronic certificates (czech commercial ban', 'Generic payment'],
  ['3B7D94000080318065B0831148C883009000', 'Online banking', ''],
  ['3B7D96000080318065B0831140C883009000', 'ING BusinessOnLine Bank eToken / Poland Gemalto Classic TPC – IM', 'Generic payment'],
  ['3B7D96000080318065B0A31100C883000000', 'Handelsbanken BankID card (Swedish bank authentication)', 'Generic payment'],
  ['3B8F800143553269AA202020202020202020', 'UBS Access Card (Mobile Online Banking, NFC, Switzerland)', 'Generic payment'],
  ['3B8F8001804F0CA0000003060B0013000000', 'Discovery kit for M24LR04E', ''],
  ['3BBB1800C01031FE4580670412B003030000', 'Philips Smart MX Szczecin University of Technology in Poland student identity card (Elektroniczna Legitymacja Studencka = student identity card) CSOB ', 'Generic payment'],
  ['3BFA1100008131FE45436F6D624F53204956', 'MyWireCard 2go Prepaid VISA Card', 'Visa'],
  ['3B6F000000664D456680031453036104F09000', 'Paypal Prepaid Card (YoUnique Money E.D.E.)', 'Generic payment'],
  ['3B6F000000664D456684030953036104F09000', 'spanish MAESTRO debit card, from Unicaja bank', 'Maestro'],
  ['3B6F000000682B4205024649534531C8079000', 'MAESTRO card, issued by Swedbank Estonia', 'Maestro'],
  ['3B6F000000682C4205024649534531C8079000', 'VISA card, issued by Swedbank Latvia VISA card, issued by the Latvian bank “Latvijas Krajbanka”', 'Visa'],
  ['3B6F00008031C0520083640219083283839000', 'Bancomer Mexican Bank', 'Generic payment'],
  ['3B6F00008031C0520752640219083283839000', 'Santander (Bank)', 'Generic payment'],
  ['3B6F00008031C052076F640219043283839000', 'Credit Card IXE Banco, México', 'Generic payment'],
  ['3B6F00008031C0520A476402B3023783839000', 'Visa debit card issued by the Spanish bank “tubancaja”', 'Visa'],
  ['3B6F00008031C052132F640219083283839000', 'Cajamadrid-UCM (Madrid, Spain) Cash/Visa Electron', 'Visa'],
  ['3B6F00008031C05216B9640566803283839000', 'Banorte Mexican Bank', 'Generic payment'],
  ['3B6F00008031E05B5457440000000000000200', 'MasterCard credit card for Far Eastern Bank, Taiwan', 'Mastercard'],
  ['3B6F00008031E06B01030502E0555555555555', 'American Express Gold Credit Card', 'American Express'],
  ['3B6F00008031E06B0201020701555555555555', 'Brazilian state bank: Caixa Econômica Federal debit card', 'Generic payment'],
  ['3B6F00008031E06B0403030405555555555555', 'Blue American Express Card', 'American Express'],
  ['3B6F00008031E06B0406030440555555555555', 'Blue American Express Card', 'American Express'],
  ['3B6F00008031E06B0508050283555555555555', 'Bank of Montreal debit card', 'Generic payment'],
  ['3B6F00008031E06B0512050287555555555555', 'American Express credit card', 'American Express'],
  ['3B6F00008031E06B071405028A555555555555', 'SolutionsBanking Canada Interac debit card', 'Generic payment'],
  ['3B6F0000805A434F4C44000000000000829000', 'LBB Berlin, MasterCard (ADAC branding?)', 'Mastercard'],
  ['3B6F0000806645460138180353023124829000', 'Electronic purse of the Universidad Politecnica of Madrid (provided by Banco Santander)', 'Generic payment'],
  ['3B6F00008066A20302023D0753023110829000', 'Electronic purse of the Universidad Politecnica of Madrid (provided by Banco Santander)', 'Generic payment'],
  ['3B6F00008066B0070101770753023110829000', 'University ID card (issued by Banco Santander Central Hispano) . Universidad Nacional de Educación a Distancia (UNED, Spain) . Universitat Politècnica', 'Generic payment'],
  ['3B6F00008066B0070101770753023124829000', 'Santander 4B Maestro University of Santiago de Compostela. Spain Polytechnical University of Madrid, Spain', 'Maestro'],
  ['3B7E1300000031C071C66501B0010440839000', 'BahnCard / Commerzbank MasterCard Credit Card', 'Mastercard'],
  ['3B7E1300000031C071C66501B4010440839000', 'Portugal Millennium BCP MAESTRO debit Card', 'Maestro'],
  ['3B7E9400008025A00000002856801012810117', 'Česká Spořitelna SERVIS24 certificate card from-the-ceska-sporitelna-bank/', 'Generic payment'],
  ['3BBE9500004103000000000000000000029000', 'touchatag SAM card Spanish University of Murcia smart ID card – Old version with CajaMurcia Banking card integrated (Maestro card) (M.Mar OS) – Also u', 'Maestro'],
  ['3B7F1100008031C0522157640218195383839000', 'banking card student id of Universitat Autonoma de Barcelona', 'Generic payment'],
  ['3B7F1100008031C0523531640566615283839000', 'Oberthur Manufactured VISA Banking card', 'Visa'],
  ['3B7F1300008031C0520271640562347083839000', 'Mastercard Debit Card issued by Caixa d’Enginyers ) – Servired', 'Mastercard'],
  ['3B7F1300008031C052056E640253043683839000', 'Mastercard from Banc Sabadell in Spain', 'Mastercard'],
  ['3B7F1300008031C052077D640566993683839000', 'VISA CEPSA (Porque tu vuelves) from Spain Visa Credit Card issued by Citibank – Servired', 'Visa'],
  ['3B7F1300008031C0520849640566993683839000', 'Spanish bank called BBVA', 'Generic payment'],
  ['3B7F1300008031C052084B640566946183839000', 'Visa Electron Card from a Spanish bank called “Caja de Ingenieros”', 'Visa'],
  ['3B7F1300008031C0520A456402B3023783839000', 'Bancaja online (Visa) Card , Entity : Bancaja Bank Spain (Bankia currently)', 'Visa'],
  ['3B7F1300008031C0520AA66402B3023783839000', 'Credit card Visa Classic by “La Caixa” (Spain)', 'Visa'],
  ['3B7F1300008031C0520AD6640566946183839000', 'Visa Credit Card issued by Caixa d’Enginyers ) – Servired', 'Visa'],
  ['3B7F1300008031C0520B71640566983683839000', 'OuroCard VISA International – Banco do Brasil', 'Visa'],
  ['3B7F1300008031C0520BBB640566983683839000', 'VISA OUROCARD Banco do Brasil S.A.', 'Visa'],
  ['3B7F1300008031C0520D1E640566946183839000', 'Universitat Politecnica de Valencia ID Visa Electron Card', 'Visa'],
  ['3B7F1300008031C0520ED4640566966183839000', 'BBVA Blue Card (VISA)', 'Visa'],
  ['3B7F1300008031C052130B6402B3023783839000', 'Visa Ourocard Platinum from Banco do Brasil', 'Visa'],
  ['3B7F1300008031C0521366640566983683839000', 'VISA Platinum from Banco do Brasil', 'Visa'],
  ['3B7F1300008031C05214D5640566966183839000', 'Visa Electron Debit Card issued by Spain Caja Madrid', 'Visa'],
  ['3B7F1300008031C0521554640566983683839000', 'VISA Card from Banc Sabadell in Spain', 'Visa'],
  ['3B7F1300008031C05215CB640566966183839000', 'Bank, Spanish group BANKIA Visa, Servired Manufactured by Saetic', 'Visa'],
  ['3B7F1300008031C0521620640566966183839000', 'Bank, Spanish BBVA Visa, Servired Manufactured by Oberthur', 'Visa'],
  ['3B7F1300008031C0521643640569937083839000', 'Gemalto Debit Card cwbU1071682A1212 issued by BANCO DE CREDITO DEL PERU', 'Generic payment'],
  ['3B7F1300008031C052172D6402B3023783839000', 'Spanish “cajamar” bank – Visa Electron Debit Card. Made by Tag Systems', 'Visa'],
  ['3B7F1300008031C05217A06402B3023783839000', 'Credit card Visa Classic by “La Caixa” (Spain)', 'Visa'],
  ['3B7F1300008031C05217B4640566983683839000', 'Credit Card Banorte International, México', 'Generic payment'],
  ['3B7F1300008031C0521880640566983683839000', 'Visa Electron Debit Card issued by “la Caixa”', 'Visa'],
  ['3B7F1300008031C05234D6640566946183839000', 'Visa Credit Card issued by Spain Obsidiana', 'Visa'],
  ['3B7F1300008031C052350D640261186383839000', 'Visa Credit Card issued by Spain Caja Madrid', 'Visa'],
  ['3B7F1300008031C0523642640566946183839000', 'Visa debit card issued by Spain Caja Madrid bank', 'Visa'],
  ['3B9E95C00A1FC68031E073FE211B66D001830D58', 'Mobile Paypass G199 NFC', 'Mastercard'],
  ['3BEF00008131FC45803180651101130001534143', 'Slovenska sporitelna (SLSP) Bank card, Maestro Card with chip', 'Maestro'],
  ['3BEF00008131FC45803180651111231002534143', 'VISA card issued by UBS, Switzerland', 'Visa'],
  ['3BEF00008131FE45434D425F436F6D4444413030', 'Master Card (emitted by bank Nordea – Lithuania)', 'Generic payment'],
  ['3BEF00008131FE45434D425F436F6D5344413030', 'VISA (Danske Bank Eesti /', 'Visa'],
  ['3BEF00008131FE4546494F4D4B5F303031203031', 'MasterCard/PayPass Card issued by Czech FIO Banka a.s. (contact chip) note the ASCII string ‘ FIOMK_001 010A’ embedded in ATR', 'Mastercard'],
  ['3BEF00FF81314245656303020302800022404895', 'Scard Sparkasse Detmold, Deutschland BLZ 47650130', 'Generic payment'],
  ['3BEF00FF813150456563080B4002800008152003', 'old banking card (electronic-card / Maestro / Geldkarte) of the Stadt-Sparkasse Duesseldorf (like the above, but old – around 2002).', 'Maestro'],
  ['3BEF00FF81316045656306031402500006510811', 'Geldkarte from Deutsche Bank, Thomson-Chip', 'Generic payment'],
  ['3BEF00FF8131FE4565631104010280000F274000', 'Postbank Geldkarte', 'Generic payment'],
  ['3BEF00FF8131FE4565631104010280000F462004', 'Postbank ec/Maestro (Germany)', 'Maestro'],
  ['3BEF00FF8131FE4565631901620280000F003500', 'Credit card (Germany, Postbank AG): VISA', 'Visa'],
  ['3BFF94000000434D425F55425369676E3030303215', 'UBS Access Card used for online banking with UBS in Switzerland. It resides in a calculator like token, that is used for a challenge response when log', 'Generic payment'],
  ['3BBF11008131FE454D43410000010001697185000000', 'Austrian “easybank” branded Mastercard, issued 2007', 'Mastercard'],
  ['3BBF11008131FE454D43410000010002082051000000', 'austrian combined card of a mastercard and ÖBB Vorteilscard (Austrian Federal Railways) VORTEILScard_MasterCard.jsp', 'Mastercard'],
  ['3BBF11008131FE454D43410000010002559133000000', 'Mastercard (Paylife Austria)', 'Mastercard'],
  ['3BFB9100FF918171FE40004120000100812063CBA08003', 'Carrefour, MasterCard credit card, Pass Banque, Oberthur – contactless/PayPass', 'Mastercard'],
  ['3BFF..00FF8131..456563........................', '.. .. Debit card (Germany): ec-cash, GeldKarte(EUR), Maestro, Cirrus, …', 'Maestro'],
  ['3BFF1300FF8131FE456563110450028000083900040205', 'German “Geldkarte” supplied by the Deutsche Bank in Karlsruhe, Baden-Württemberg, Germany.', 'Generic payment'],
  ['3BFF1300FF8131FE456563110450028000085400042305', 'Maestrocard/Geldkarte (Stadtsparkasse Haltern, Germany)', 'Maestro'],
  ['3BFF1800FF81313C4565630D0231025000109000260004', 'Maestrocard/Geldkarte (Postbank, Germany)', 'Maestro'],
  ['3BFF1800FF81313C4565630D0231025000109001550004', 'Volksbank VR-BankCard (GeldKarte)', 'Generic payment'],
  ['3BFF1800FF81313C4565630D0231025000109005290004', 'Geldkarte/HBCI(DDV-1) (Stadtsparkasse Vorpommern, Germany)', 'Generic payment'],
  ['3BFF1800FF81313C4565630D0231025000109007880004', 'HBCI- Karte (Berliner Sparkasse, Germany)', ''],
  ['3BFF1800FF81313C4565630D0231025000109014060004', 'Geldkarte/HBCI(DDV-1) (Staedtische Sparkasse Offenbach, Germany)', 'Generic payment'],
  ['3BFF1800FF81313C4565630D0231025000109014440004', 'Geldkarte/HBCI (Kreissparkasse Ebersberg, Deutschland)', 'Generic payment'],
  ['3BFF1800FF81313C4565630D0231025000109055700004', 'EC- Card from DKB (Deutsche Kreditbank AG)', 'Generic payment'],
  ['3BFF1800FF8131FE4565630D0450028000089009700005', 'Landesbank baden-Württemberg Geldkarte', 'Generic payment'],
  ['3BFF1800FF8131FE4565630D07630528000D9081060006', 'Geldkarte/HBCI (Frankfurter Sparkasse, Germany)', 'Generic payment'],
  ['3BFF1800FF8131FE4565630D07630764000D........06', '.. Giesecke & Devrient GmbH ROM Mask=ecD6.3 Init-Table=SDP2G3F0.E_2 (BES0), SWP2G3H0.E_1 (CS0) Signaturerstellungseinheit ZKA TUVIT.93125.TU.12.2005 B', ''],
  ['3BFF1800FF8131FE4565630D07630764000D9058450006', 'Stadtsparkasse München electronic cash card / Geldkarte', 'Generic payment'],
  ['3BFF1800FF8131FE4565630D07630764000D9073070006', 'Sparkasse Acchen HBCI Geld Karte', ''],
  ['3BFF1800FF8131FE4565630D07630764000D9074320006', 'German HBCI-Banking Card with ‘Geldkarte’ from the bank “Sparkasse Marburg-Biedenkopf”', 'Generic payment'],
  ['3BFF1800FF8131FE4565630D07630764000D9092610006', 'Geldkarte (Frankfurter Sparkasse, Germany)', 'Generic payment'],
  ['3BFF1800FF8131FE4565630D08650764000D........06', '.. Giesecke & Devrient GmbH ROM Mask=ecD6.5 Init-Table=SWP3G5J0.E_1 (CS0) Signaturerstellungseinheit ZKA Banking Signature Card, v6.51 TUVIT.93129.TU.', 'Generic payment'],
  ['3BFF1800FF8131FE4565630D0C760764000D9581200007', 'Master Card Credit Card issued by WGZ bank (all german volksbank institutes use them)', 'Generic payment'],
  ['3BFF1800FF8131FE456563110350028000082770020605', 'old banking card (electronic-card / Maestro / Geldkarte) of the “Volksbank Gelderland eG” (around 2003)', 'Maestro'],
  ['3BFF1800FF8131FE456563110540025000105510030305', 'belongs to a banking card (electronic-card / Maestro / Geldkarte). the bank calls it “VR-BankCard”. the banks name is “Volksbank Gelderland eG” and is', 'Maestro'],
  ['3BFF1800FF8131FE456563110640025000100550031005', 'HBCI- Karte (Bordesholmer Sparkasse, Germany)', ''],
  ['3BFF1800FF8131FE456563110640025000101910042005', 'Stadtsparkasse München HBCI card / Geldkarte', 'Generic payment'],
  ['3BFF1800FF8131FE456563110640025000102560051205', 'Geldkarte/HBCI(DDV-1) (Stadtsparkasse Vorpommern, Germany)', 'Generic payment'],
  ['3BFF1800FF8131FE456563110640025000102730021605', 'GeldKarte from Sparkasse bank', 'Generic payment'],
  ['3BFF1800FF8131FE456563110640025000102780032505', 'Volksbank VR-BankCard (GeldKarte)', 'Generic payment'],
  ['3BFF1800FF8131FE456563110640025000102850011105', 'HBCI Bancing Card of Sparkasse Pforzheim', 'Generic payment'],
  ['3BFF1800FF8131FE45656311066202800011........06', '.. Giesecke & Devrient GmbH ROM Mask=ecD6.2, Init-Table=SDI1G280.E_1 (BES0), Signaturerstellungseinheit ZKA Banking Signature Card, v6.2b NP & 6.2f NP', 'Generic payment'],
  ['3BFF1800FF8131FE456563110662028000110660030406', 'Geldkarte (Volksbank Offenburg, Germany)', 'Generic payment'],
  ['3BFF1800FF8131FE456563110662028000111650051706', 'FinTS (BBBank Karlsruhe, Germany)', ''],
  ['3BFF1800FF8131FE456563110662028000112090030906', 'Geldkarte [ec, Maestro] (1822 direkt Frankfurter Sparkasse, Germany)', 'Maestro'],
  ['3BFF1800FF8131FE456563110662028000114350011706', 'EC- Card of Sparkasse Pforzheim Calw', 'Generic payment'],
  ['3BFF1800FF8131FE456563110751025000107280000206', 'Maestro Card Deutsche Kredit Bank (DKB) / Germany', 'Maestro'],
  ['3BFF1800FF8131FE45656311076402800011........06', '.. Giesecke & Devrient GmbH ROM Mask=ecD6.4 Init-Table=SDI2G4G0.E_4 (BES0), SWI2G4H0.E_2 (CS0) Signaturerstellungseinheit ZKA 17.01.2006 Banking Signa', ''],
  ['3BFF1800FF8131FE45656311084302500010........05', '.. Gemalto ROM Mask=ZKA 680 V5A Init-Table=SSI3P3M6E_1 (MS0) Massen-Signaturerstellungseinheit ZKA Banking Signature Card, Version 5.11M TUVIT.93148.T', 'Generic payment'],
  ['3BFF1800FF8131FE456563110843025000104650010805', 'HBCI- Karte (Sparkasse Altmark-West, Salzwedel, Germany)', ''],
  ['3BFF1800FF8131FE456563110843025000108470010405', 'HBCI Card (1822 direkt Frankfurter Sparkasse, Germany) Geldkarte [ec, Maestro]', 'Maestro'],
  ['3BFF1800FF8131FE45656311086602800011........06', '.. Giesecke & Devrient GmbH ROM Mask=ecD6.6 Init-Table=SDI3G6G0.E_3 (BES0), SSI3G6M0.E_2 (S0), SWI3G6H0.E_3 (CS0) Signaturerstellungseinheit ZKA Banki', ''],
  ['3BFF1800FF8131FE456563110866028000114050031806', 'banking card (electronic-card / Maestro / Geldkarte). the bank+calls it “S-Card” or “Sparkassen-Card”. the banks name is “Stadtsparkasse Duesseldorf” ', 'Maestro'],
  ['3BFF1800FF8131FE456563110866028000115600031806', 'Geldkarte [ec, Maestro] (Sparkasse Langen-Seligenstadt, Germany)', 'Maestro'],
  ['3BFF1800FF8131FE4565631A0141025000105209056705', 'Maestro/Geldkarte (BBBank Karlsruhe, Germany)', 'Maestro'],
  ['3BFF9600FF8131FE4565630D09710764000D0003545007', 'Commerzbank ServiceCard / Maestro / GeldKarte / Cirrus / girocard / CashGroup / electronic cash', 'Maestro'],
  ['3BFF9600FF8131FE4565631901500280000F002B004650', 'Sparkasse Bremen Germany HBCI DDV', ''],
  ['3BFF9600FF8131FE4565631901500280000F002F002550', 'German Postbank Giro card with electronic cash, Maestro, GeldKarte features', 'Maestro'],
  ['3BFF00FF8131..456563............................', 'Debit card (Germany): ec-cash, GeldKarte(EUR), Maestro, Cirrus, …', 'Maestro'],
  ['3BFD9100FF918171FE40004120004100818031C073D621C0D8', 'Sparkasse Hanau – German contactless GeldKarte (PPSE, girogo)', 'Generic payment'],
];

export interface AtrIdentity {
  /** The normalised ATR that was looked up, uppercase hex without separators. */
  atr: string;
  /** Card / application description from the reference list. */
  description: string;
  /** Payment scheme when the description names one, else null. */
  scheme: string | null;
  /** 'exact' = the ATR is the registered pattern; 'prefix' = the ATR extends it. */
  match: 'exact' | 'prefix';
  /** The matched pattern contains wildcard bytes. */
  wildcard: boolean;
  /** 'inverse' when TS = 3F, otherwise 'direct'. */
  convention: 'direct' | 'inverse';
  /** Several registry entries share the matched prefix, so the description is one of several. */
  ambiguous: boolean;
}

/** 5 bytes — below this a shared prefix is not evidence of anything. */
const MIN_PREFIX_NIBBLES = 10;

const EXACT_LOOKUP = new Map<string, number>();
const WILDCARD_ENTRIES: number[] = [];

for (let i = 0; i < ATR_ENTRIES.length; i++) {
  const pattern = ATR_ENTRIES[i][0];
  if (pattern.includes('.')) {
    WILDCARD_ENTRIES.push(i);
  } else if (!EXACT_LOOKUP.has(pattern)) {
    EXACT_LOOKUP.set(pattern, i);
  }
}

export const ATR_REGISTRY_SIZE = ATR_ENTRIES.length;

/** Uppercase hex with every separator stripped — the form the ACR122U reports. */
export function normalizeAtr(raw: string): string {
  return String(raw || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
}

function patternMatches(pattern: string, atr: string, exactOnly: boolean): boolean {
  if (pattern.length > atr.length) return false;
  if (exactOnly && pattern.length !== atr.length) return false;
  for (let i = 0; i < pattern.length; i += 2) {
    if (pattern[i] === '.') continue;
    if (pattern[i] !== atr[i] || pattern[i + 1] !== atr[i + 1]) return false;
  }
  return true;
}

function build(atr: string, index: number, match: 'exact' | 'prefix', ambiguous: boolean): AtrIdentity {
  const [pattern, description, scheme] = ATR_ENTRIES[index];
  return {
    atr,
    description,
    scheme: scheme || null,
    match,
    wildcard: pattern.includes('.'),
    convention: atr.startsWith('3F') ? 'inverse' : 'direct',
    ambiguous,
  };
}

/**
 * Identify a card from its ATR.
 *
 * An exact (wildcard-aware) match wins. Otherwise the longest registered pattern
 * that the ATR extends is used, reported as `match: 'prefix'` and flagged
 * `ambiguous` when several entries share that prefix.
 */
export function identifyAtr(rawAtr: string): AtrIdentity | null {
  const atr = normalizeAtr(rawAtr);
  if (atr.length < 4 || atr.length % 2 !== 0) return null;

  const exactIndex = EXACT_LOOKUP.get(atr);
  if (exactIndex !== undefined) return build(atr, exactIndex, 'exact', false);

  for (const index of WILDCARD_ENTRIES) {
    if (patternMatches(ATR_ENTRIES[index][0], atr, true)) {
      return build(atr, index, 'exact', false);
    }
  }

  let bestLength = 0;
  let bestIndex = -1;
  let ties = 0;

  for (let i = 0; i < ATR_ENTRIES.length; i++) {
    const pattern = ATR_ENTRIES[i][0];
    if (pattern.length < MIN_PREFIX_NIBBLES) continue;
    if (pattern.length > atr.length) continue;
    if (pattern.length < bestLength) continue;
    if (!patternMatches(pattern, atr, false)) continue;

    if (pattern.length > bestLength) {
      bestLength = pattern.length;
      bestIndex = i;
      ties = 0;
    } else if (ATR_ENTRIES[i][1] !== ATR_ENTRIES[bestIndex][1]) {
      ties++;
    }
  }

  if (bestIndex < 0) return null;
  return build(atr, bestIndex, 'prefix', ties > 0);
}

/** True when the ATR belongs to a known payment card. */
export function isPaymentCardAtr(rawAtr: string): boolean {
  return identifyAtr(rawAtr) !== null;
}

/** Card description for an ATR, or null when it is not a recognised payment card. */
export function describeAtr(rawAtr: string): string | null {
  const hit = identifyAtr(rawAtr);
  return hit ? hit.description : null;
}
