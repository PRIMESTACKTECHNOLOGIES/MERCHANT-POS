import axios from "axios";

export interface PaymentRequest {
  amount: number;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
}

export interface PaymentResponse {
  success: boolean;
  data?: any;
  error?: any;
}

export async function executeMyFatoorahPayment({
  amount,
  cardNumber,
  expiryMonth,
  expiryYear,
  cvv
}: PaymentRequest): Promise<PaymentResponse> {
  try {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.MYFATOORAH_API_KEY}`
    };

    const body = {
      PaymentMethodId: 2, // Direct Card Payment
      InvoiceValue: amount,
      CardNumber: cardNumber,
      ExpiryMonth: expiryMonth,
      ExpiryYear: expiryYear,
      SecurityCode: cvv
    };

    const response = await axios.post(
      `${process.env.MYFATOORAH_BASE_URL}ExecutePayment`,
      body,
      { headers }
    );

    return {
      success: true,
      data: response.data
    };

  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}