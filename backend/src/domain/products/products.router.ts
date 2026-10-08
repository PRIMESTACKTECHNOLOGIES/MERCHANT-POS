import express from "express";
import { productsController } from "./products.controller";

const router = express.Router();

// Mounted at /merchant/v1/products — so "/" = GET /merchant/v1/products
router.get("/", productsController.list.bind(productsController));
router.post("/", productsController.create.bind(productsController));
router.get("/products", productsController.list.bind(productsController)); // alias
router.post("/products", productsController.create.bind(productsController)); // alias

export { router as productsRouter };
