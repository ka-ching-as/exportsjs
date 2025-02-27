import * as _ from "lodash"
import * as parsefullname from "parse-full-name"
import { fetch } from "cross-fetch"
import { SkipExport } from "./SkipExport"

enum TaxType {
    VAT = "vat",
    SALES_TAX = "sales_tax"
}

const apiVersion = "2021-04"

export class ShopifyTransform {

    data: any
    configuration: any

    constructor(configuration: any, data: any) {
        this.data = data
        this.configuration = configuration
    }

    async exportNewsletterSignup(): Promise<any> {

        this.validateNewsletterConfiguration()
        const signup = this.data

        const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/customers/search.json?query=email:${signup.email}`

        const response = await fetch(url, this.shopifyRequestOptions())
        const responseJson: any = await response.json()
        if (responseJson.customers.length > 0) {
            const existingCustomer = responseJson.customers[0]
            const customerId = existingCustomer.id
            if (existingCustomer.accepts_marketing === true) {
                // Customer is already signed up for email marketing
                throw new SkipExport("Customer is already signed up for email marketing")
            }
            const update = {
                customer: {
                    id: customerId,
                    accepts_marketing: true
                }
            }
            const putUrl = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/customers/${customerId}.json`

            const options = this.shopifyRequestOptions()
            options.body = JSON.stringify(update)
            options.method = "PUT"
            await  fetch(putUrl, options)
            throw new SkipExport("Customer is updated through a PUT request")
        }

        const customer: any = {
            email: signup.email,
            first_name: signup.first_name ?? "-",
            last_name: signup.last_name ?? "-",
            accepts_marketing: true
        }
        return { customer: customer }
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
        this.validateSalesConfiguration()

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
        if (sale.summary.customer && sale.summary.customer.identifier) {
            const customerId = Number(sale.summary.customer.identifier)
            order.customer = { id: customerId }

            // It appears that 'accepts_marketing' is cleared when an order
            // without buyer_accepts_marketing is added.
            // A workaround is to lookup the customer and set the flag
            // based on what is found on the customer

            const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/customers/${customerId}.json`
            try {

                const response = await fetch(url, this.shopifyRequestOptions())
                const customerResult: any = await response.json()
                order.buyer_accepts_marketing = customerResult.customer?.accepts_marketing
            } catch (error) {
                console.warn(`Failed looking up customer: ${error}`)
            }
        }

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

        if (this.configuration.shop_sales !== true) {
            // shipping
            const shippingLine = this.shippingLines(sale, this.configuration.ecom_id)[0]
            const shipping = shippingLine.behavior.shipping
            const shippingAddress = shipping.address
            const shippingCustomerInfo = shipping.customer_info
            const parsedName = parsefullname.parseFullName(shippingAddress.name)

            const shopifyShipping: any = {}
            shopifyShipping.first_name = parsedName.first || ""
            shopifyShipping.last_name = parsedName.last || ""
            shopifyShipping.address1 = shippingAddress.street
            shopifyShipping.city = shippingAddress.city
            shopifyShipping.zip = shippingAddress.postal_code
            shopifyShipping.country_code = shippingAddress.country_code || this.configuration.default_country_code
            shopifyShipping.phone = shippingCustomerInfo.phone

            if (shipping.method_id) {
                const shopifyShippingLine: any = {
                    code: shipping.method_id,
                    price: shippingLine.total,
                    title: shipping.method_id // Required field. Don't have anything better to put here unfortunately...
                }
                const taxes = this.shopifyTaxLines(shippingLine.taxes)
                if (taxes.length > 0) {
                    shopifyShippingLine.tax_lines = taxes
                }
                order.shipping_lines = [shopifyShippingLine]
            }

            order.shipping_address = shopifyShipping
            order.email = shippingCustomerInfo.email
        } else {
            // Shop sales
            order.fulfillment_status = "fulfilled"
            order.fulfillments = [
                {
                    "location_id": Number(locationId)
                }
            ]
        }

        // line items
        const shopifyLineItems: any[] = []

        const lineItems = (this.configuration.shop_sales === true) ? this.nonEcommerceLines(sale) : this.ecommerceLines(sale, this.configuration.ecom_id)

        for (const lineItem of lineItems) {
            let variantId: string | undefined = lineItem.variant_id
            if (_.isNil(variantId)) {
                try {
                    const shopifyProduct = await this.shopifyProduct(lineItem.id)
                    if (shopifyProduct?.product?.variants[0]?.id) {
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

            const taxes = this.shopifyTaxLines(lineItem.taxes)
            if (taxes.length > 0) {
                shopifyLineItem.tax_lines = taxes
            }

            shopifyLineItems.push(shopifyLineItem)
        }
        order.line_items = shopifyLineItems

        order.tags = "ka-ching"

        // transactions
        order.financial_status = "paid"

        return { order: order }
    }

    async exportStockEvent(): Promise<any> {
        // validate configuration
        this.validateStockConfiguration()

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
        const inventoryItemId = await this.inventoryItemId(productId, this.data.variant_id)
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

    private async inventoryItemId(productId: string, variantId: string | undefined): Promise<string | undefined> {
        let inventoryItemId: string | undefined = undefined
        const configuration = this.configuration
        if (!_.isNil(variantId)) {
            const url = `https://${configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/variants/${variantId}.json`
            try {
                const response = await fetch(url, this.shopifyRequestOptions())
                const shopifyVariantResult: any = await response.json()
                if (shopifyVariantResult?.variant?.inventory_item_id) {
                    inventoryItemId = `${shopifyVariantResult.variant.inventory_item_id}`
                }
            } catch (error) {
                console.info(`Got error when trying to get variant with id ${variantId} from Shopify: ${error.toString()}`)
            }
        } else {
            try {
                const shopifyProductResult = await this.shopifyProduct(productId)
                if (shopifyProductResult?.product?.variants[0]?.inventory_item_id) {
                    inventoryItemId = `${shopifyProductResult.product.variants[0].inventory_item_id}`
                }
            } catch (error) {
                console.info(`Got error when trying to get product with id ${productId} from Shopify: ${error.toString()}`)
            }
        }
        return inventoryItemId
    }

    private async shopifyProduct(productId: string): Promise<any> {
        const url = `https://${this.configuration.shopify_id}.myshopify.com/admin/api/${apiVersion}/products/${productId}.json`
        const response = await fetch(url, this.shopifyRequestOptions())
        return await response.json()
    }

    private shopifyRequestOptions(): RequestInit {
        const base64 = Buffer.from(`${this.configuration.api_key}:${this.configuration.password}`).toString("base64")
        const basicAuthValue = `Basic ${base64}`
        const options: RequestInit = {
            headers: {
                Authorization: basicAuthValue
            }
        }
        return options
    }

    private shopifyTaxLines(taxes: any[]): any[] {
        const result = (taxes || []).map((tax: any) => {
            return {
                price: tax.amount,
                rate: tax.rate,
                title: tax.name
            }
        })
        return result
    }

    private ecommerceLines(sale: any, ecomId: string): any[] {
        return (sale.summary.line_items || []).filter((line: any) => {
            const behavior = line.behavior || {}
            return !_.isNil(line.ecom_id) && line.ecom_id === ecomId && _.isNil(behavior.shipping)
        })
    }

    private nonEcommerceLines(sale: any): any[] {
        return (sale.summary.line_items || []).filter((line: any) => {
            return _.isNil(line.ecom_id)
        })
    }

    private shippingLines(sale: any, ecomId: string): any[] {
        return (sale.summary.line_items || []).filter((line: any) => {
            const behavior = line.behavior || {}
            return !_.isNil(behavior.shipping) && !_.isNil(line.ecom_id) && line.ecom_id === ecomId
        })
    }

    private validateNewsletterConfiguration() {
        const configuration = this.configuration
        if (_.isNil(configuration.api_key) || typeof (configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration")
        }

        if (_.isNil(configuration.password) || typeof (configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration")
        }

        if (_.isNil(configuration.shopify_id) || typeof (configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration")
        }
    }

    private validateSalesConfiguration() {
        const configuration = this.configuration
        if (_.isNil(configuration.api_key) || typeof (configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration")
        }

        if (_.isNil(configuration.password) || typeof (configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration")
        }

        if (_.isNil(configuration.shopify_id) || typeof (configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration")
        }

        if (_.isNil(configuration.tax_type) || typeof (configuration.tax_type) !== "string" || (configuration.tax_type !== TaxType.VAT && configuration.tax_type !== TaxType.SALES_TAX)) {
            throw new Error("tax_type is invalid in configuration - must be present and either 'vat' or 'sales_tax'")
        }

        if (_.isNil(configuration.default_country_code) || typeof (configuration.default_country_code) !== "string") {
            throw new Error("default_country_code is missing from configuration")
        }

        if (_.isNil(configuration.location_id_map) || typeof (configuration.location_id_map) !== "object") {
            throw new Error("shopify location_id_map is missing from configuration")
        }

        if (_.isNil(configuration.ecom_id) || typeof (configuration.ecom_id) !== "string") {
            throw new Error("shopify ecom_id is missing from configuration")
        }
    }

    private validateStockConfiguration() {
        const configuration = this.configuration
        if (_.isNil(configuration.api_key) || typeof (configuration.api_key) !== "string") {
            throw new Error("shopify api key is missing from configuration")
        }

        if (_.isNil(configuration.password) || typeof (configuration.password) !== "string") {
            throw new Error("shopify password is missing from configuration")
        }

        if (_.isNil(configuration.shopify_id) || typeof (configuration.shopify_id) !== "string") {
            throw new Error("shopify shop id is missing from configuration")
        }

        if (_.isNil(configuration.location_id_map) || typeof (configuration.location_id_map) !== "object") {
            throw new Error("shopify location_id_map is missing from configuration")
        }
    }

    private validateSale(sale: any) {
        if (this.configuration.shop_orders === true) {
            // Shop orders
            if (sale.voided) {
                throw new Error(`Sale is voided`)
            }
            // ensure non-ecom lines
            const nonEcomLineItems = this.nonEcommerceLines(sale)
            if (nonEcomLineItems.length === 0) {
                throw new Error(`No non-ecommerce line items on sale`)
            }

        } else {
            // Ecom orders

            // returns and voided are not handled here
            if (sale.voided || sale.summary.is_return) {
                throw new Error(`Sale is either voided ${sale.voided} or is return ${sale.is_return}`)
            }

            // ensure ecom lines
            const ecomLineItems = this.ecommerceLines(sale, this.configuration.ecom_id)
            if (ecomLineItems.length === 0) {
                throw new Error(`No ecommerce line items on sale`)
            }
            const ecomLineItemsWithoutProductId = ecomLineItems.filter((line: any) => { return !_.isNil(line.id) })
            if (ecomLineItemsWithoutProductId.length !== ecomLineItems.length) {
                throw new Error(`1 or more ecommerce lines are missing product id`)
            }

            // ensure exactly 1 shipping line
            const shippingLines = this.shippingLines(sale, this.configuration.ecom_id)
            if (shippingLines.length !== 1) {
                throw new Error(`Invalid number of shipping lines on sale ${shippingLines.length}`)
            }
        }
    }
}