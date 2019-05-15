"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const request = require("request-promise");
class ShopifyTransform {
    constructor(configuration, data) {
        this.data = data;
        this.configuration = configuration;
    }
    exportStockEvent() {
        return __awaiter(this, void 0, void 0, function* () {
            this.validateStockConfiguration(this.configuration);
            if (_.isNil(this.data.stock_location_id)) {
                throw new Error("Missing stock location id");
            }
            const locationId = this.configuration.location_id_map[this.data.stock_location_id];
            if (_.isNil(locationId)) {
                throw new Error(`Unknown stock location id ${this.data.stock_location_id} - couldn't resolve shopify location id`);
            }
            const productId = this.data.product_id;
            if (_.isNil(productId)) {
                throw new Error("Missing product id");
            }
            const base64 = new Buffer(`${this.configuration.api_key}:${this.configuration.password}`).toString("base64");
            const basicAuthValue = `Basic ${base64}`;
            const options = {
                headers: {
                    Authorization: basicAuthValue
                },
                json: true
            };
            let inventoryItemId = undefined;
            const variantId = this.data.variant_id;
            if (!_.isNil(variantId)) {
                const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/2019-04/variants/${variantId}.json`;
                const shopifyVariantResult = yield request.get(url, options);
                if (shopifyVariantResult &&
                    shopifyVariantResult.variant &&
                    shopifyVariantResult.variant.inventory_item_id) {
                    inventoryItemId = `${shopifyVariantResult.variant.inventory_item_id}`;
                }
            }
            else {
                const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/2019-04/products/${productId}.json`;
                const shopifyProductResult = yield request.get(url, options);
                console.info(`Products result $${JSON.stringify(shopifyProductResult)}`);
                if (shopifyProductResult &&
                    shopifyProductResult.product &&
                    shopifyProductResult.product.variants &&
                    shopifyProductResult.product.variants[0] &&
                    shopifyProductResult.product.variants[0].inventory_item_id) {
                    inventoryItemId = `${shopifyProductResult.variant.inventory_item_id}`;
                }
            }
            if (_.isNil(inventoryItemId)) {
                throw new Error(`Failed to find inventory item id from product id ${productId} and variant id ${variantId}`);
            }
            const result = {
                location_id: locationId,
                inventory_item_id: Number(inventoryItemId),
            };
            const adjustment = this.data.adjustment;
            const newStockCount = this.data.new_stock_value;
            if (!_.isNil(adjustment)) {
                result.available_adjustment = adjustment;
            }
            else if (!_.isNil(newStockCount)) {
                result.available = newStockCount;
            }
            else {
                throw new Error(`Unhandled stock adjustment for stock event: ${this.data ? JSON.stringify(this.data) : this.data}`);
            }
            return result;
        });
    }
    validateStockConfiguration(configuration) {
        if (_.isNil(configuration.api_key) || typeof (configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration");
        }
        if (_.isNil(configuration.password) || typeof (configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration");
        }
        if (_.isNil(configuration.shopify_id) || typeof (configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration");
        }
        if (_.isNil(configuration.location_id_map) || typeof (configuration.location_id_map) !== "object") {
            throw new Error("shopify location_id_map is missing from configuration");
        }
    }
}
exports.ShopifyTransform = ShopifyTransform;
//# sourceMappingURL=ShopifyTransform.js.map