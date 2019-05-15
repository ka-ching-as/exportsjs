import * as _ from "lodash"
import * as request from "request-promise"

export class ShopifyTransform {

    data: any
    configuration: any

    constructor(configuration: any, data: any) {
        this.data = data
        this.configuration = configuration
    }

    async exportStockEvent() {
        // validate configuration
        this.validateStockConfiguration(this.configuration)

        // find shopify location id
        if (_.isNil(this.data.stock_location_id)) {
            throw new Error("Missing stock location id")
        }
        
        const locationId = this.configuration.location_id_map[this.data.stock_location_id]
        if (_.isNil(locationId)) {
            throw new Error(`Unknown stock location id ${this.data.stock_location_id} - couldn't resolve shopify location id`)
        }

        // validate presence of product id
        const productId = this.data.product_id
        if (_.isNil(productId)) {
            throw new Error("Missing product id")
        }

        // lookup inventory item id in shopify
        const base64 = new Buffer(`${this.configuration.api_key}:${this.configuration.password}`).toString("base64")
        const basicAuthValue = `Basic ${base64}`
        const options: request.RequestPromiseOptions = {
            headers: {
                Authorization: basicAuthValue
            },
            json: true
        }
        let inventoryItemId: string | undefined = undefined
        const variantId = this.data.variant_id
        if (!_.isNil(variantId)) {
            const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/2019-04/variants/${variantId}.json`
            const shopifyVariantResult = await request.get(url, options)
            if (shopifyVariantResult && 
                shopifyVariantResult.variant && 
                shopifyVariantResult.variant.inventory_item_id) {
                inventoryItemId = `${shopifyVariantResult.variant.inventory_item_id}`
            }
        } else {
            const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/2019-04/products/${productId}.json`
            const shopifyProductResult = await request.get(url, options)
            console.info(`Products result $${JSON.stringify(shopifyProductResult)}`)
            if (shopifyProductResult && 
                shopifyProductResult.product && 
                shopifyProductResult.product.variants && 
                shopifyProductResult.product.variants[0] && 
                shopifyProductResult.product.variants[0].inventory_item_id) {
                inventoryItemId = `${shopifyProductResult.variant.inventory_item_id}`
            }
        }

        if (_.isNil(inventoryItemId)) {
            throw new Error(`Failed to find inventory item id from product id ${productId} and variant id ${variantId}`)
        }
        
        // build and return result
        const result: any = {
            location_id: locationId,
            inventory_item_id: Number(inventoryItemId),
        }

        const adjustment = this.data.adjustment as number
        const newStockCount = this.data.new_stock_value as number
        if (!_.isNil(adjustment)) {
            result.available_adjustment = adjustment
        } else if (!_.isNil(newStockCount)) {
            result.available = newStockCount
        } else {
            throw new Error(`Unhandled stock adjustment for stock event: ${this.data ? JSON.stringify(this.data) : this.data}`)
        }

        return result
    }

    private validateStockConfiguration(configuration: any) {
        if (_.isNil(configuration.api_key) || typeof(configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration")
        }

        if (_.isNil(configuration.password) || typeof(configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration")
        }

        if (_.isNil(configuration.shopify_id) || typeof(configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration")
        }

        if (_.isNil(configuration.location_id_map) || typeof(configuration.location_id_map) !== "object") {
            throw new Error("shopify location_id_map is missing from configuration")
        }
    }
}