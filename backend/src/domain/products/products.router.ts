import express from "express";
import { productsController } from "./products.controller";

const router = express.Router();

router.get("/products", productsController.list.bind(productsController));
router.post("/products", productsController.create.bind(productsController));

export { router as productsRouter };
