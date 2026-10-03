USE justech_marketplace;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE product_images;
TRUNCATE TABLE products;
TRUNCATE TABLE categories;
TRUNCATE TABLE sellers;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO sellers
(store_name, slug, description, logo_url, banner_url, verified)
VALUES
('Lagos Tech Hub', 'lagos-tech-hub',
 'Laptops, phones and accessories for students, creators and professionals.',
 'https://placehold.co/160x160?text=LTH',
 'https://placehold.co/1200x350?text=Lagos+Tech+Hub', 1),
('Ankara & Co', 'ankara-and-co',
 'Modern African fashion and handmade pieces.',
 'https://placehold.co/160x160?text=A%26C',
 'https://placehold.co/1200x350?text=Ankara+%26+Co', 1);

INSERT INTO categories (name, slug) VALUES
('Computers', 'computers'),
('Phones', 'phones'),
('Fashion', 'fashion'),
('Home', 'home');

INSERT INTO products
(seller_id, category_id, title, slug, description, specs, price, old_price, stock, image_url, rating, review_count)
VALUES
(1, 1, 'Student Laptop 14" 8GB/256GB', 'student-laptop-14',
 'Light laptop for school, office work and everyday productivity.',
 '{"RAM":"8GB","Storage":"256GB SSD","Screen":"14 inch"}',
 385000, 420000, 12,
 'https://placehold.co/700x520?text=Student+Laptop',
 4.4, 18),

(1, 1, 'Pro Laptop 15" 16GB/512GB', 'pro-laptop-15',
 'Powerful laptop for developers, designers and demanding workloads.',
 '{"RAM":"16GB","Storage":"512GB SSD","Screen":"15.6 inch"}',
 690000, NULL, 5,
 'https://placehold.co/700x520?text=Pro+Laptop',
 4.7, 31),

(1, 2, 'Smartphone X 128GB', 'smartphone-x-128',
 'Dual-SIM smartphone with a large battery and modern camera system.',
 '{"Storage":"128GB","Battery":"5000mAh","SIM":"Dual SIM"}',
 185000, 210000, 30,
 'https://placehold.co/700x520?text=Smartphone',
 4.3, 22),

(2, 3, 'Ankara Print Shirt', 'ankara-print-shirt',
 'Hand-finished cotton shirt with a modern African-inspired print.',
 '{"Material":"Cotton","Fit":"Regular","Pattern":"Ankara"}',
 18500, NULL, 40,
 'https://placehold.co/700x520?text=Ankara+Shirt',
 4.6, 14),

(2, 4, 'Woven Storage Basket', 'woven-basket',
 'Handwoven decorative basket for home storage and organization.',
 '{"Material":"Raffia","Use":"Storage","Style":"Handwoven"}',
 9500, 12000, 25,
 'https://placehold.co/700x520?text=Woven+Basket',
 4.5, 9);

INSERT INTO product_images (product_id, image_url, sort_order, is_primary)
SELECT id, image_url, 0, 1 FROM products;
