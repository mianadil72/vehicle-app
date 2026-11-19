-- Sample inventory (formerly src/data/vehicles.ts). Only inserts when the table is empty,
-- with fixed IDs so existing /vehicles/:id links keep working.

IF NOT EXISTS (SELECT 1 FROM dbo.Vehicles)
BEGIN
  SET IDENTITY_INSERT dbo.Vehicles ON;

  INSERT INTO dbo.Vehicles (VehicleId, Make, Model, ModelYear, Price, Category, Condition, Mileage, Color, ColorHex, StockNumber)
  VALUES
    (1,  N'Toyota',    N'Camry XSE',              2024, 31995, N'Sedan',    N'New',       12,    N'Celestial Silver', '#b8bcc2', 'T24-1031'),
    (2,  N'Honda',     N'Accord EX',              2022, 25450, N'Sedan',    N'Used',      28410, N'Platinum White',   '#e9e9e4', 'H22-0877'),
    (3,  N'BMW',       N'330i',                   2023, 39800, N'Sedan',    N'Certified', 14220, N'Black Sapphire',   '#1d2330', 'B23-0412'),
    (4,  N'Ford',      N'Explorer XLT',           2024, 41250, N'SUV',      N'New',       8,     N'Carbonized Gray',  '#4a4d52', 'F24-2210'),
    (5,  N'Jeep',      N'Grand Cherokee Limited', 2021, 33900, N'SUV',      N'Used',      41870, N'Diamond Black',    '#15171b', 'J21-0655'),
    (6,  N'Toyota',    N'RAV4 Hybrid',            2023, 34600, N'SUV',      N'Certified', 16750, N'Blueprint',        '#2f4f86', 'T23-0990'),
    (7,  N'Ford',      N'F-150 Lariat',           2024, 58900, N'Truck',    N'New',       15,    N'Rapid Red',        '#a3141c', 'F24-3001'),
    (8,  N'Chevrolet', N'Silverado 1500 LT',      2022, 42300, N'Truck',    N'Used',      33190, N'Summit White',     '#f2f2ef', 'C22-1477'),
    (9,  N'Ram',       N'1500 Big Horn',          2023, 44750, N'Truck',    N'Certified', 19840, N'Granite Crystal',  '#5a5e63', 'R23-0321'),
    (10, N'Ford',      N'Mustang GT',             2024, 46200, N'Coupe',    N'New',       5,     N'Grabber Blue',     '#1f78d1', 'F24-4108'),
    (11, N'Chevrolet', N'Camaro 2SS',             2021, 37950, N'Coupe',    N'Used',      22600, N'Shadow Gray',      '#55585c', 'C21-0219'),
    (12, N'Tesla',     N'Model 3 Long Range',     2023, 38990, N'Electric', N'Used',      18300, N'Pearl White',      '#f4f3ef', 'E23-0101'),
    (13, N'Hyundai',   N'Ioniq 5 SEL',            2024, 46500, N'Electric', N'New',       10,    N'Gravity Gold',     '#8c7d55', 'E24-0233'),
    (14, N'Ford',      N'Mustang Mach-E Premium', 2023, 43200, N'Electric', N'Certified', 11950, N'Star White',       '#ecebe6', 'E23-0188'),
    (15, N'Honda',     N'Odyssey EX-L',           2023, 39700, N'Van',      N'Certified', 21040, N'Obsidian Blue',    '#1e2a44', 'H23-0560'),
    (16, N'Chrysler',  N'Pacifica Touring L',     2022, 31800, N'Van',      N'Used',      36720, N'Velvet Red',       '#6e1420', 'C22-0744');

  SET IDENTITY_INSERT dbo.Vehicles OFF;
END
GO

-- Luxury stock (Ferrari, Mercedes-Benz, BMW). Added row by row, skipping any stock number that
-- already exists, so it also reaches databases seeded before these rows were added.
INSERT INTO dbo.Vehicles (Make, Model, ModelYear, Price, Category, Condition, Mileage, Color, ColorHex, StockNumber)
SELECT v.Make, v.Model, v.ModelYear, v.Price, v.Category, v.Condition, v.Mileage, v.Color, v.ColorHex, v.StockNumber
FROM (VALUES
    (N'Ferrari',       N'296 GTB',                 2023, 338900, N'Coupe',    N'Certified', 3850,  N'Rosso Corsa',             '#c8102e', 'FE23-0296'),
    (N'Ferrari',       N'Roma',                    2024, 247500, N'Coupe',    N'New',       25,    N'Blu Pozzi',               '#1b2a4a', 'FE24-0101'),
    (N'Ferrari',       N'F8 Tributo',              2021, 319800, N'Coupe',    N'Used',      6420,  N'Giallo Modena',           '#f2c200', 'FE21-0008'),
    (N'Ferrari',       N'SF90 Stradale',           2022, 529000, N'Coupe',    N'Certified', 2150,  N'Bianco Avus',             '#f3f2ee', 'FE22-0090'),
    (N'Ferrari',       N'Purosangue',              2024, 398000, N'SUV',      N'New',       40,    N'Grigio Titanio',          '#6b6e70', 'FE24-0400'),
    (N'Mercedes-Benz', N'S 580 4MATIC',            2024, 127450, N'Sedan',    N'New',       18,    N'Obsidian Black',          '#16181c', 'MB24-0580'),
    (N'Mercedes-Benz', N'E 450 4MATIC',            2022, 54900,  N'Sedan',    N'Used',      24310, N'Selenite Grey',           '#7d8084', 'MB22-0450'),
    (N'Mercedes-Benz', N'AMG G 63',                2023, 189500, N'SUV',      N'Certified', 9870,  N'Polar White',             '#f1f1ee', 'MB23-0063'),
    (N'Mercedes-Benz', N'GLE 450 4MATIC',          2024, 72350,  N'SUV',      N'New',       12,    N'Sodalite Blue',           '#23395b', 'MB24-1450'),
    (N'Mercedes-Benz', N'EQS 580 4MATIC Sedan',    2023, 109900, N'Electric', N'Certified', 7640,  N'High-Tech Silver',        '#b9bcbf', 'MB23-2580'),
    (N'BMW',           N'M8 Competition Coupe',    2024, 138800, N'Coupe',    N'New',       9,     N'Frozen Marina Bay Blue',  '#2b4f7a', 'BM24-0808'),
    (N'BMW',           N'M5 Competition',          2022, 86500,  N'Sedan',    N'Used',      18760, N'Marina Bay Blue',         '#1f4f8f', 'BM22-0505'),
    (N'BMW',           N'750i xDrive',             2021, 52800,  N'Sedan',    N'Used',      31200, N'Carbon Black',            '#1b1f2b', 'BM21-0750'),
    (N'BMW',           N'X7 xDrive40i',            2023, 79900,  N'SUV',      N'Certified', 12480, N'Mineral White',           '#e8e7e2', 'BM23-0740'),
    (N'BMW',           N'X5 M Competition',        2024, 124600, N'SUV',      N'New',       14,    N'Isle of Man Green',       '#1f4d3a', 'BM24-0555'),
    (N'BMW',           N'i7 xDrive60',             2024, 124200, N'Electric', N'New',       15,    N'Oxide Grey',              '#5d5f60', 'BM24-0760')
) AS v (Make, Model, ModelYear, Price, Category, Condition, Mileage, Color, ColorHex, StockNumber)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Vehicles x WHERE x.StockNumber = v.StockNumber);
GO
