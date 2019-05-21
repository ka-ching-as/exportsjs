import * as _ from "lodash"
import * as parsefullname from "parse-full-name"
import * as request from "request-promise"
import { SkipExport } from "./SkipExport";

enum TaxType {
    VAT = "vat",
    SALES_TAX = "sales_tax"
}

export class ShopifyTransform {

    data: any
    configuration: any

    constructor(configuration: any, data: any) {
        this.data = data
        this.configuration = configuration
    }

    // This method takes ecom line items and shipping information
    // and turns it into a shopify order.
    // The use case is to use the Shopify webshop for processing
    // ecommerce orders made in Ka-ching.
    // In regards to amounts and prices the goal is to have them make
    // sense with regards to the Ka-ching order and tax wise as well. 
    // To do that I've used to totals and taxes on the lines as they
    // are. Information about discounts are not provided to Shopify.
    // https://help.shopify.com/en/api/reference/orders/order
    async exportSale(): Promise<any> {
        // validate configuration
        this.validateSalesConfiguration(this.configuration)
        
        // validate sale
        this.validateSale(this.data)

        // local sale var
        const sale = this.data

        // look up location id
        const locationId = this.configuration.location_id_map[sale.source.shop_id]
        if (_.isNil(locationId)) {
            throw new Error(`Unknown stock location id ${sale.source.shop_id} - couldn't resolve shopify location id`)
        }

        // build shopify order
        const order: any = {
            currency: sale.base_currency_code,
            location_id: Number(locationId)
        }

        // customer
        order.customer = { id: Number(sale.summary.customer.identifier) }

        // tax type - Shopify can only handle either vat type or sales tax type, not mixed. 
        // The taxes_included field specifies whether taxes er included in sub total or not
        if (this.configuration.tax_type === TaxType.VAT) {
            order.taxes_included = true
        } else {
            order.taxes_included = false
        }

        // comment
        if (sale.comment) {
            order.note_attributes = [{
                name: "Basket comment",
                value: sale.comment
            }]
        }

        // shipping
        const shippingLine = this.shippingLines(sale)[0]
        const shipping = shippingLine.behavior.shipping
        const shippingAddress = shipping.address
        const shippingCustomerInfo = shipping.customer_info
        const parsedName = parsefullname.parseFullName(shippingAddress.name)
        
        const shopifyShipping: any = {}
        shopifyShipping.first_name = parsedName.first || ""
        shopifyShipping.last_name = parsedName.last || ""
        shopifyShipping.address1 = shippingAddress.street
        shopifyShipping.city = shippingAddress.city
        shopifyShipping.zip = shippingAddress.postal_code
        if (shippingAddress.country_code) {
            shopifyShipping.country_code = shippingAddress.country_code || this.configuration.default_country_code
        }
        shopifyShipping.phone = shippingCustomerInfo.phone
        
        if (shipping.method_id) {
            const shopifyShippingLine: any = {
                code: shipping.method_id,
                price: shippingLine.total,
                title: shipping.method_id // Required field. Don't have anything better to put here unfortunately...
            }
            const taxes = this.shopifyTaxLines(shippingLine.takes)
            if (taxes.length > 0) {
                shopifyShippingLine.tax_lines = taxes
            }
            order.shipping_lines = [shopifyShippingLine]
        }

        order.shipping = shopifyShipping
        order.email = shippingCustomerInfo.email

        // line items
        const shopifyLineItems: any[] = []
        for (const lineItem of this.ecommerceLines(sale)) {
            let variantId: string | undefined = lineItem.variant_id
            if (_.isNil(variantId)) {
                try {
                    const shopifyProduct = await this.shopifyProduct(lineItem.id, this.configuration)
                    if (shopifyProduct && 
                        shopifyProduct.product && 
                        shopifyProduct.product.variants && 
                        shopifyProduct.product.variants[0] && 
                        shopifyProduct.product.variants[0].id) {
                        variantId = `${shopifyProduct.product.variants[0].id}`
                    }
                } catch (error) {
                    console.info(`Got error when trying to get variant with id ${lineItem.id} from Shopify: ${error.toString()}`)
                }
            }

            if (!variantId) {
                throw new Error(`Couldn't find variant id in Shopify for product id ${lineItem.id}`)
            }
            const shopifyLineItem: any = {
                price: lineItem.total,
                quantity: lineItem.quantity,
                variant_id: Number(variantId)
            }

            const taxes = this.shopifyTaxLines(shopifyLineItem.takes)
            if (taxes.length > 0) {
                shopifyLineItem.tax_lines = taxes
            }

            shopifyLineItems.push(shopifyLineItem)
        }
        order.line_items = shopifyLineItems

        // transactions
        order.financial_status = "paid"

        return { order: order }
    }

    async exportStockEvent(): Promise<any> {
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

        // Shopify ids are numbers so do an early check here and fail with SkipExport
        if (_.isNaN(Number(productId))) {
            throw new SkipExport(`SkipExport - Non compatible Shopify id ${productId}`)
        }

        // lookup inventory item id in shopify
        const inventoryItemId = await this.inventoryItemId(productId, this.data.variant_id, this.configuration)
        if (_.isNil(inventoryItemId)) {
            throw new Error(`Failed to find inventory item id from product id ${productId} and variant id ${this.data.variant_id}`)
        }
        
        // build and return result
        const result: any = {
            location_id: Number(locationId),
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

    private async inventoryItemId(productId: string, variantId: string | undefined, configuration: any): Promise<string | undefined> {
        let inventoryItemId: string | undefined = undefined
        if (!_.isNil(variantId)) {
            const url = `https://${configuration.shopify_id}.myshopify.com/admin/api/2019-04/variants/${variantId}.json`
            try {
                const shopifyVariantResult = await request.get(url, this.shopifyRequestOptions(configuration))
                if (shopifyVariantResult &&
                    shopifyVariantResult.variant &&
                    shopifyVariantResult.variant.inventory_item_id) {
                    inventoryItemId = `${shopifyVariantResult.variant.inventory_item_id}`
                }
            } catch (error) {
                console.info(`Got error when trying to get variant with id ${variantId} from Shopify: ${error.toString()}`)
            }
        } else {
            try {
                const shopifyProductResult = await this.shopifyProduct(productId, configuration)
                if (shopifyProductResult &&
                    shopifyProductResult.product &&
                    shopifyProductResult.product.variants &&
                    shopifyProductResult.product.variants[0] &&
                    shopifyProductResult.product.variants[0].inventory_item_id) {
                    inventoryItemId = `${shopifyProductResult.product.variants[0].inventory_item_id}`
                }
            } catch (error) {
                console.info(`Got error when trying to get product with id ${productId} from Shopify: ${error.toString()}`)
            }
        }
        return inventoryItemId
    }

    private async shopifyProduct(productId: string, configuration: any): Promise<any> {
        const url = `https://${configuration.shopify_id}.myshopify.com/admin/api/2019-04/products/${productId}.json`
        return await request.get(url, this.shopifyRequestOptions(configuration))
    }

    private shopifyRequestOptions(configuration: any): request.RequestPromiseOptions {
        const base64 = new Buffer(`${configuration.api_key}:${configuration.password}`).toString("base64")
        const basicAuthValue = `Basic ${base64}`
        const options: request.RequestPromiseOptions = {
            headers: {
                Authorization: basicAuthValue
            },
            json: true
        }
        return options
    }

    private shopifyTaxLines(taxes: any[]): any[] {
        const result = (taxes || []).map((tax: any) => {
            return {
                price: tax.amount,
                rate: tax.rate,
                title: tax.name
            }
        })
        return result
    }

    private ecommerceLines(sale: any): any[] {
        return (sale.summary.line_items || []).filter((line: any)=> { 
            const behavior = line.behavior || {}
            return !_.isNil(line.ecom_id) && _.isNil(behavior.shipping)
        })
    }

    private shippingLines(sale: any): any[] {
        return (sale.summary.line_items || []).filter((line: any)=> { 
            const behavior = line.behavior || {}
            return !_.isNil(behavior.shipping)
        })
    }

    private validateSalesConfiguration(configuration: any) {
        if (_.isNil(configuration.api_key) || typeof(configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration")
        }

        if (_.isNil(configuration.password) || typeof(configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration")
        }

        if (_.isNil(configuration.shopify_id) || typeof(configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration")
        }

        if (_.isNil(configuration.tax_type) || typeof(configuration.tax_type) !== "string" || (configuration.tax_type !== TaxType.VAT && configuration.tax_type !== TaxType.SALES_TAX)) {
            throw new Error("tax_type is invalid in configuration - must be present and either 'vat' or 'sales_tax'")
        }

        if (_.isNil(configuration.default_country_code) || typeof(configuration.default_country_code) !== "string") {
            throw new Error("default_country_code is missing from configuration")
        }

        if (_.isNil(configuration.location_id_map) || typeof(configuration.location_id_map) !== "object") {
            throw new Error("shopify location_id_map is missing from configuration")
        }
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

    private validateSale(sale: any) {
        // returns and voided are not handled here
        if (sale.voided || sale.summary.is_return) {
            throw new Error(`Sale is either voided ${sale.voided} or is return ${sale.is_return}`)
        }

        // ensure customer id
        if (!sale.summary.customer || !sale.summary.customer.identifier || Number(sale.summary.customer.identifier) === NaN) {
            throw new Error(`Customer id invalid on sale. Customer: ${JSON.stringify(sale.summary.customer)}`)
        }

        // ensure ecom lines
        const ecomLineItems = this.ecommerceLines(sale)
        if (ecomLineItems.length === 0) {
            throw new Error(`No ecommerce line items on sale`)
        }
        const ecomLineItemsWithoutProductId = ecomLineItems.filter((line: any) => { return !_.isNil(line.id) })
        if (ecomLineItemsWithoutProductId.length !== ecomLineItems.length) {
            throw new Error(`1 or more ecommerce lines are missing product id`)
        }
        
        // ensure exactly 1 shipping line
        const shippingLines = this.shippingLines(sale)
        if (shippingLines.length !== 1) {
            throw new Error(`Invalid number of shipping lines on sale ${shippingLines.length}`)
        }
    }
}