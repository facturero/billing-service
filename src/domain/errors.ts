export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, 403);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Solicitud inválida') {
    super(message, 400);
  }
}

export class NotFoundOrganizationError extends NotFoundError {
  constructor() {
    super('Organización no encontrada');
  }
}

export class InvoiceNotFoundError extends NotFoundError {
  constructor(invoiceId: string) {
    super(`Factura ${invoiceId} no encontrada`);
  }
}

export class SequenceNotFoundError extends NotFoundError {
  constructor() {
    super('Secuencia no encontrada para este punto de emisión');
  }
}

export class CustomerNotFoundError extends AppError {
  constructor() {
    super('Cliente no encontrado', 400);
  }
}

export class ProductNotFoundError extends AppError {
  constructor() {
    super('Producto no encontrado', 400);
  }
}

export class EstablishmentNotFoundError extends AppError {
  constructor() {
    super('Establecimiento no encontrado', 400);
  }
}

export class TaxRateNotFoundError extends AppError {
  constructor() {
    super('Tasa de impuesto no encontrada', 400);
  }
}

export class EmissionPointNotFoundError extends AppError {
  constructor() {
    super('Punto de emisión no encontrado', 400);
  }
}

export class InvalidInvoiceStatusError extends AppError {
  constructor(expected: string, actual: string) {
    super(`La factura debe estar en estado '${expected}' pero está '${actual}'`, 400);
  }
}

export class CustomerDisabledError extends AppError {
  constructor() {
    super('El cliente está desactivado y no puede recibir facturas', 400);
  }
}

export class ProductDisabledError extends AppError {
  constructor() {
    super('El producto está desactivado y no puede incluirse en facturas', 400);
  }
}

export class EmissionPointInactiveError extends AppError {
  constructor() {
    super('El punto de emisión no está activo', 400);
  }
}

export class LineQuantityMustBePositiveError extends BadRequestError {
  constructor() {
    super('La cantidad debe ser mayor que cero');
  }
}

export class LineUnitPriceMustBePositiveError extends BadRequestError {
  constructor() {
    super('El precio unitario debe ser mayor que cero');
  }
}

export class MismatchedTotalsError extends AppError {
  constructor() {
    super('Los totales calculados no cuadran, posible error en el cálculo', 500);
  }
}
